Numbas.addExtension('upload-files',['jme'],function(extension) {
    var scope = extension.scope;

    class FileUploader {
        disabled = false;

        constructor(element, part, title, events, answer_changed, options) {
            this.files = [];

            this.element = element;
            this.answer_changed = answer_changed;
            this.options = options;
            this.max_file_size = parseFloat(this.options.max_file_size);
            this.max_num_files = parseInt(this.options.max_num_files);
            
            this.part = part;

            let attempt_pk_m = window.parent.location.pathname.match(/\/run_attempt\/(\d+)/);
            const attempt_pk = attempt_pk_m ? attempt_pk_m[1] : 7059;

            this.element.innerHTML = `
<section class="uploader"></section>
<div class="uploading alert info invisible">Uploading. Please wait. <button type="button" class="abort">Cancel</button></div>
<div class="error alert warning invisible" aria-live="polite">The upload failed: <span class="message"></span></div>
<section class="files">
    <h4>Uploaded files</h4>
    <ul></ul>
</section>
<section class="no-files">
    <p>No files have been uploaded.</p>
</section>
`;
            const form = this.upload_form = document.createElement('form');
            form.setAttribute('method', 'POST');
            form.setAttribute('action', this.options.upload_url);
            form.setAttribute('enctype', 'multipart/form-data');
            element.querySelector('.uploader').append(form);
            form.innerHTML = `
<input type="hidden" name="attempt" value="${attempt_pk}">
<label>Upload files: <input type="file" name="file" multiple accept="${this.options.accept_types.join(',')}"></label>
<input type="hidden" name="part" value="${part.full_path}">
<button type="submit" class="btn primary">Upload</button>
`;

            this.file_input = this.upload_form.querySelector('input[type="file"]');

            this.file_input.addEventListener('change', ({target}) => {
                this.validate_input();
            });

            this.ul_files = element.querySelector('.files ul');

            for(let [name, handler] of Object.entries(events)) {
                form.addEventListener(name, e => handler(this, e));
            }

            element.querySelector('form').addEventListener('submit', async (e) => {
                e.preventDefault();
                this.upload_files(form);
            });

            element.querySelector('.abort').addEventListener('click', async (e) => {
                if(!this.last_upload) {
                    return;
                }
                this.last_upload.abort_controller.abort();
                this.element.querySelector('.uploading').classList.add('invisible');
                this.last_upload = null;
            });
        }
        
        validate_input() {
            const input = this.file_input;
            const files = [...input.files];
            const nfiles = files.concat(this.files.filter(f => !files.some(f2 => f2.name == f.name)));
            const total_size = Math.sumPrecise(nfiles.map(f => f.size)) / 2**20;
            const {max_file_size, max_num_files} = this;
            if(max_file_size > 0 && total_size > max_file_size) {
                input.setCustomValidity(`The uploaded files are too big (${Numbas.math.niceNumber(Numbas.math.precround(total_size,2))}MB). The maximum allowed size is ${Numbas.math.niceNumber(Numbas.math.precround(max_file_size,2))}MB.`);
                return;
            }
            if(max_num_files > 0 && nfiles.length > max_num_files) {
                input.setCustomValidity(`You have selected too many files. You may upload at most ${max_num_files} ${Numbas.util.pluralise(max_num_files,'file','files')}.`);
                return;
            }
            input.setCustomValidity('');
        }

        async upload_files(form) {
            const fd = new FormData(form);

            this.element.querySelector('.uploading').classList.remove('invisible');
            this.hide_error();

            const abort_controller = new AbortController();
            const request = fetch(this.options.upload_url, {
                method: 'POST',
                body: fd,
                signal: abort_controller.signal
            });

            this.last_upload = {request, abort_controller};

            let response;
            try {
                response = await request;
            } catch(e) {
                console.error(e);
                this.show_error(e.message);
                return;
            }

            if(this.last_upload?.request == request) {
                this.element.querySelector('.uploading').classList.add('invisible');
                this.last_upload = null;
            }

            if(!response.ok) {
                this.show_error(`The server returned status code ${response.status}, ${response.statusText}.`);
            }

            const res = await response.json();

            for(let file of res.files) {
                for(let ofile of this.files.filter(f => f.name == file.name)) {
                    this.delete_file(ofile);
                }
                this.files.push(file);
                this.add_file(file);
            }
            this.store_answer();
            this.part.display.controls.submit(false);
            this.file_input.value = '';
        }

        show_error(error) {
            this.element.querySelector('.error .message').innerHTML = error.toString();
            this.element.querySelector('.error').classList.remove('invisible');
        }

        hide_error() {
            this.element.querySelector('.error').classList.add('invisible');
        }

        store_answer() {
            this.answer_changed({valid: true, value: this.files});
        }

        setAnswerJSON({valid, value}) {
            if(valid) {
                this.files = value;
                this.ul_files.innerHTML = '';
                for(let file of this.files) {
                    this.add_file(file);
                }
            }
        }

        disable() {
            this.upload_form.remove();
            for(let input of this.element.querySelectorAll('input')) {
                input.remove();
            }
            for(let button of this.element.querySelectorAll('button')) {
                button.remove();
            }
            this.disabled = true;
            this.element.setAttribute('disabled', true);
        }

        add_file(file) {
            const li = document.createElement('li');
            li.innerHTML = `
<a target="uploaded-file" href="${file.url}"><code>${file.name}</code></a>
`+(this.disabled ? '' : `<button type="button" class="delete-file btn danger">Delete</button>`);
            if(!this.disabled) {
                li.querySelector('.delete-file').addEventListener('click', async (e) => {
                    const go = () => {
                        this.delete_file(file);
                        this.store_answer();
                        this.part.submit();
                    }

                    const exam_display = this.part.question?.exam?.display;

                    if(exam_display) {
                        exam_display.root_element.showConfirm(`Delete the file <code>${file.name}</code>?`, go);
                    } else {
                        go();
                    }
                });
            }
            this.ul_files.append(li);
        }

        async delete_file(file) {
            const li = this.ul_files.querySelector('li:has(a[href="'+file.url+'"])');
            this.ul_files.removeChild(li);
            this.files = this.files.filter(f => f != file);
            this.validate_input();
            await fetch(file.delete_url, {method: 'POST'});
        }

    }

    Numbas.answer_widgets.register_custom_widget({
        name: 'file-uploader', 
        niceName: 'File uploader',
        widget: FileUploader, 
        signature: 'list', 
        answer_to_jme: function(answer) {
            return Numbas.jme.wrapValue(answer);
        },
        options_definition: [
            {
                name: 'upload_url',
                label: 'Upload URL',
                input_type: 'string',
                default_value: '/student-files/upload'
            },
            {
                name: 'accept_types',
                label: 'Accepted file types',
                input_type: 'list_of_strings',
                default_value: []
            },
            {
                name: 'max_file_size',
                label: 'Maximum file size (MB)',
                input_type: 'mathematical_expression',
                default_value: "0",

            },
            {
                name: 'max_num_files',
                label: 'Maximum number of files',
                input_type: 'mathematical_expression',
                default_value: "0",
            }
        ],
        scorm_storage: {
            interaction_type: function(part) { return 'fill-in'; },
            correct_answer: function(part) { return part.input_options().correctAnswer; },
            student_answer: function(part) { return JSON.stringify(part.studentAnswer); },
            load: function(part, data) { return JSON.parse(data.answer || '[]'); }
        }
    });

});
