// Projects in the renderer: reading a project's PDFs to text for Claude, and
// the "Add to project" picker used by every app's File screen and by Recent.

import { icon } from './icons.js';
import { escapeHtml, h, toast } from './shell.js';

let reader = null;
// pdf.js comes from the same lazy bundle the Cite dialog uses.
function pdfReader() {
  const url = './pdftext.js';
  reader ||= import(url).catch((err) => {
    reader = null;
    throw err;
  });
  return reader;
}

// Reads each PDF in the project that has no text yet. onStep(done, total) reports progress.
export async function preparePdfs(id, onStep = null) {
  const p = await window.office.projects.get(id);
  if (p?.error) throw new Error(p.error);
  const todo = p.files.filter((f) => f.kind === 'pdf' && !f.missing && !f.hasText);
  let done = 0;
  for (const f of todo) {
    onStep?.(done, todo.length, f);
    try {
      const got = await window.office.projects.pdfBytes(id, f.path);
      if (got?.error) throw new Error(got.error);
      const { readPdf } = await pdfReader();
      const read = await readPdf(got.data, 5000);
      await window.office.projects.saveText(id, got.key, read.text);
    } catch (err) {
      console.warn('project pdf', f.name, err);
    }
    done++;
  }
  onStep?.(done, todo.length, null);
  return todo.length;
}

export async function newProjectDialog(dialog, { name = '', paths = [], copy = false } = {}) {
  const got = await dialog({
    title: 'New project',
    body: '<p class="muted">A project keeps files together: papers, notes, data, a LaTeX project. Claude reads all of them when you chat in the project.</p>',
    fields: [
      { name: 'name', label: 'Name', value: name, placeholder: 'Thesis chapter 3' },
      { name: 'instructions', label: 'What is it about? (Claude reads this first, optional)', type: 'textarea', rows: 3, placeholder: 'I am writing a review of… Use the papers to…' },
    ],
    ok: 'Create',
  });
  if (!got) return null;
  const p = await window.office.projects.create({ name: got.name, instructions: got.instructions, paths, copy });
  if (p?.error) {
    toast(p.error, 'error');
    return null;
  }
  return p;
}

// Adds a saved file to a project picked from a small list (or a new one). The
// file stays where it is, so the project always has its latest save.
export async function addToProject(dialog, file, { name } = {}) {
  if (!file || /^(gdrive|onedrive|gsheets):/i.test(file)) {
    toast('Save the file on this computer first, then add it to a project.', 'error');
    return null;
  }
  const list = await window.office.projects.list();
  const fileName = name || file.split(/[\\/]/).pop();
  if (!list.length) return newProjectDialog(dialog, { paths: [file] }).then((p) => p && (toast(`Added ${fileName} to ${p.name}`), p));
  const NEW = '__new';
  const got = await dialog({
    title: 'Add to project',
    body: `<p class="muted">Add <b>${escapeHtml(fileName)}</b> to a project. It stays where it is, and Claude reads its latest saved version.</p>`,
    fields: [{ name: 'project', label: 'Project', type: 'select', options: [...list.map((p) => ({ value: p.id, label: `${p.name} (${p.items} item${p.items === 1 ? '' : 's'})` })), { value: NEW, label: 'New project…' }] }],
    ok: 'Add',
  });
  if (!got) return null;
  if (got.project === NEW) return newProjectDialog(dialog, { paths: [file] }).then((p) => p && (toast(`Added ${fileName} to ${p.name}`), p));
  const res = await window.office.projects.addPaths(got.project, [file]);
  if (res?.error) return toast(res.error, 'error');
  const target = list.find((p) => p.id === got.project);
  if (res.skipped?.length && !res.added.length) toast(`${fileName}: ${res.skipped[0].error}`);
  else toast(`Added ${fileName} to ${target.name}`);
  return target;
}

// A small "Project" chip for the Claude pane: which project Claude reads.
export function projectChip(project, onClear) {
  const chip = h('span', 'cp-file cp-project', `${icon('project', 12)}<span>Project: ${escapeHtml(project.name)}</span>`);
  chip.title = 'Claude reads every file in this project';
  if (onClear) {
    const x = h('button', '', '×');
    x.type = 'button';
    x.title = 'Stop using this project';
    x.onclick = onClear;
    chip.append(x);
  }
  return chip;
}
