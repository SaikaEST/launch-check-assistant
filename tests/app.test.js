'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_STORE_KEY = 'launch-check-assistant-v1';
const PROJECTS_STORE_KEY = 'launch-check-projects-v1';

function htmlText(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity =>
    ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"})[entity]);
}

// Only the DOM surfaces used by app startup and reconciliation are simulated.
// Application functions, script ordering, storage and event handlers run unchanged.
class ElementStub {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this._html = '';
    const classes = new Set();
    this.classList = {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    };
  }

  set innerHTML(html) {
    this._html = String(html);
    if (this.id === 'autoMap') this.document.readMapSelects(this._html);
    if (this.id === 'modalBody') this.document.readFormFields(this._html);
    const options = [...this._html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    if (options.length) {
      const selected = options.find(option => /\bselected\b/.test(option[1])) || options[0];
      const value = /\bvalue="([^"]*)"/.exec(selected[1]);
      this.value = htmlText(value ? value[1] : selected[2]);
    }
  }

  get innerHTML() { return this._html; }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  emit(type, target = this) {
    for (const handler of this.listeners.get(type) || []) handler({target});
  }

  focus() { this.document.activeElement = this; }
  remove() {}
  click() {
    if (this.download) this.document.downloads.push({name: this.download, blob: this.document.blobs.get(this.href)});
  }
}

class DocumentStub {
  constructor() {
    this.elements = new Map();
    this.mapSelects = [];
    this.formFields = [];
    this.body = {style: {}, appendChild() {}};
    this.listeners = new Map();
    this.downloads = [];
    this.blobs = new Map();
    this.contextInputs = ['project', 'version', 'cutoff', 'scope'].map(key => {
      const input = this.getElementById('context_' + key);
      input.dataset.context = key;
      return input;
    });
    this.autoWrite = this.getElementById('autoWriteButton');
    this.autoWrite.disabled = true;
    this.getElementById('autoHeader').checked = true;
    this.getElementById('autoPrecision').value = '2';
    this.getElementById('autoTarget').value = 'new';
    this.getElementById('newProjectTemplate').value = 'blank';
    for (const id of ['workspaceView', 'workspaceActions', 'overlay', 'autoOverlay', 'projectOverlay']) {
      this.getElementById(id).hidden = true;
    }
  }

  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new ElementStub(id, this));
    return this.elements.get(id);
  }

  addEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  emit(type, target) {
    for (const handler of this.listeners.get(type) || []) handler({target, preventDefault() {}});
  }

  createElement(tag) {
    assert.equal(tag, 'a', 'only download anchors are needed in this test browser');
    return new ElementStub('download-anchor', this);
  }

  readMapSelects(html) {
    this.mapSelects = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(match => {
      const id = /\bid="([^"]*)"/.exec(match[1])[1];
      const select = this.getElementById(id);
      select.dataset.side = /\bdata-side="([^"]*)"/.exec(match[1])[1];
      select.dataset.k = /\bdata-k="([^"]*)"/.exec(match[1])[1];
      select.innerHTML = match[2];
      return select;
    });
  }

  readFormFields(html) {
    const controls = [];
    for (const match of html.matchAll(/<input\b([^>]*\bname="(f_[^"]+)"[^>]*)>/g)) {
      const element = new ElementStub(match[2], this);
      element.name = match[2];
      element.type = /\btype="([^"]+)"/.exec(match[1])?.[1] || 'text';
      element.value = htmlText(/\bvalue="([^"]*)"/.exec(match[1])?.[1] || '');
      element.checked = /\bchecked\b/.test(match[1]);
      controls.push(element);
    }
    for (const match of html.matchAll(/<(select|textarea)\b([^>]*\bname="(f_[^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g)) {
      const element = new ElementStub(match[3], this);
      element.name = match[3];
      element.type = match[1] === 'select' ? 'select-one' : 'textarea';
      if (match[1] === 'select') element.innerHTML = match[4];
      else element.value = htmlText(match[4]);
      controls.push(element);
    }
    this.formFields = controls;
  }

  querySelectorAll(selector) {
    if (selector === '[data-context]') return this.contextInputs;
    if (selector === '#modalBody [name^="f_"]') return this.formFields;
    const map = /^#autoMap select\[data-side="(src|sys)"\]$/.exec(selector);
    if (map) return this.mapSelects.filter(select => select.dataset.side === map[1]);
    throw new Error('Unexpected DOM query in integration test: ' + selector);
  }

  querySelector(selector) {
    if (selector === '[data-act="autoWrite"]') return this.autoWrite;
    const form = /^#modalBody \[name="(f_[^"]+)"\]$/.exec(selector);
    if (form) return this.formFields.find(element => element.name === form[1]) || null;
    throw new Error('Unexpected DOM query in integration test: ' + selector);
  }
}

function boot(saved = {v: 2, items: []}, memory, options = {}) {
  const storage = memory || new Map();
  if (!memory && saved !== null) storage.set(LEGACY_STORE_KEY, JSON.stringify(saved));
  const document = new DocumentStub();
  const timers = new Map();
  const fileReaders = [];
  const failures = {write: false};
  let timerId = 0;
  const sandbox = {
    document,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => {
        if (failures.write) throw new Error('模拟本地存储已满');
        storage.set(key, String(value));
      }
    },
    setTimeout: handler => { timers.set(++timerId, handler); return timerId; },
    clearTimeout: id => timers.delete(id),
    confirm: () => true,
    alert: message => { throw new Error('Unexpected alert: ' + message); },
    Blob: class {
      constructor(parts, options) { this.content = parts.join(''); this.type = options.type; }
    },
    URL: {
      createObjectURL: blob => { const id = 'blob:test-' + document.blobs.size; document.blobs.set(id, blob); return id; },
      revokeObjectURL: id => document.blobs.delete(id)
    },
    FileReader: class {
      readAsText(file, encoding) { this.file = file; this.encoding = encoding; this.readyState = 1; fileReaders.push(this); }
      abort() { this.readyState = 2; this.aborted = true; if (this.onabort) this.onabort(); }
    }
  };
  sandbox.window = sandbox;
  if (options.storageAccessError) Object.defineProperty(sandbox, 'localStorage', {get() {
    const error = new Error('模拟浏览器拒绝存储访问');
    error.name = 'SecurityError';
    throw error;
  }});
  const context = vm.createContext(sandbox);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(assets\/[^"?]+\.js)"[^>]*>/g)].map(match => match[1]);
  assert.ok(scripts.includes('assets/app.js'), 'load the real application entry point');
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, script), 'utf8'), context, {filename: script});
  }
  const run = code => vm.runInContext(code, context);
  return {document, storage, run, timers, fileReaders, failures, snapshot: code => JSON.parse(JSON.stringify(run(code)))};
}

// Existing business regressions explicitly choose their migrated project. Startup
// itself always remains on the folder list and does not restore an open project.
function workBoot(saved = {v: 2, items: []}, memory) {
  const app = boot(saved, memory);
  const projects = app.snapshot('projectManager.list()');
  assert.ok(projects.length, 'this fixture must provide a project to open explicitly');
  app.run('openProject(' + JSON.stringify(projects[0].id) + ')');
  return app;
}

function activeSavedProject(app) {
  return app.snapshot('projectManager.get(activeProjectId)');
}

function createFolder(app, name, context = {}, items = []) {
  return app.snapshot('projectManager.create(' + JSON.stringify({name, context, items}) + ')');
}

function clickAction(app, act, id) {
  const button = {dataset: {act}};
  const item = id ? {dataset: {id}} : null;
  app.document.emit('click', {closest(selector) {
    if (selector === '[data-act]') return button;
    if (selector === '.item') return item;
    throw new Error('Unexpected click ancestor query: ' + selector);
  }});
}

function setItems(app, items) {
  app.run('state.items = ' + JSON.stringify(items) + '.map(normalizeItem)');
}

function reconcile(app, src, sys = '', precision = 2) {
  app.document.getElementById('autoSrc').value = src;
  app.document.getElementById('autoSys').value = sys;
  app.document.getElementById('autoPrecision').value = String(precision);
  app.run('runAutoCheck()');
  assert.equal(app.document.getElementById('autoErr').textContent, '');
  assert.equal(app.run('autoResult !== null'), true, 'analysis should complete');
  assert.equal(app.document.autoWrite.disabled, false);
}

test('first visit opens only the project folder list without seed or previous-project records', () => {
  const app = boot(null);
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.deepEqual(app.snapshot('projectManager.list()'), []);
  assert.equal(app.document.getElementById('projectHomeView').hidden, false);
  assert.equal(app.document.getElementById('workspaceView').hidden, true);
  assert.equal(app.document.getElementById('workspaceActions').hidden, true);
  assert.equal(app.storage.has(LEGACY_STORE_KEY), false);
});

test('legacy data becomes a closed folder and a reload never automatically opens it', () => {
  const item = {id: 'legacy-visible', category: 'data', title: '旧项目专有记录', status: '进行中'};
  const app = boot({v: 2, items: [item], context: {project: 'DEMO-OLD'}});
  const projects = app.snapshot('projectManager.list()');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'legacy-v1');
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.deepEqual(app.snapshot('state.context'), {project: '', version: '', cutoff: '', scope: ''});
  assert.doesNotMatch(app.document.getElementById('list').innerHTML, /旧项目专有记录/);
  app.run('openProject("legacy-v1")');
  assert.equal(app.run('state.items[0].id'), item.id);
  const reloaded = boot(null, app.storage);
  assert.equal(reloaded.run('activeProjectId'), null);
  assert.deepEqual(reloaded.snapshot('state.items'), []);
  assert.equal(reloaded.document.getElementById('workspaceView').hidden, true);
  assert.equal(reloaded.snapshot('projectManager.list()').length, 1, 'migration must not repeat');
  assert.equal(JSON.parse(reloaded.storage.get(LEGACY_STORE_KEY)).items[0].id, item.id);
});

test('new blank folders contain only their own supplied project code and version', () => {
  const app = boot(null);
  app.document.getElementById('newProjectName').value = '  DEMO 项目A上线  ';
  app.document.getElementById('newProjectCode').value = 'DEMO-A';
  app.document.getElementById('newProjectVersion').value = 'A-v1';
  app.document.getElementById('newProjectTemplate').value = 'blank';
  app.run('createProjectFromForm()');
  assert.ok(app.run('activeProjectId'));
  assert.equal(activeSavedProject(app).name, 'DEMO 项目A上线');
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.deepEqual(app.snapshot('state.context'), {project: 'DEMO-A', version: 'A-v1', cutoff: '', scope: ''});
  assert.equal(app.document.getElementById('projectHomeView').hidden, true);
  assert.equal(app.document.getElementById('workspaceView').hidden, false);
  assert.equal(app.document.getElementById('workspaceActions').hidden, false);
  assert.equal(app.document.getElementById('exampleBanner').hidden, true);
});

test('switching folders isolates checks, context and saves without changing the other project', () => {
  const app = boot(null);
  const a = createFolder(app, '项目A', {project: 'SHIP-A', version: 'A-v1'});
  const b = createFolder(app, '项目B', {project: 'SHIP-B', version: 'B-v1'});
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  setItems(app, [{id: 'check-a', category: 'data', title: '只属于A的核对', note: 'A人工结论'}]);
  app.run('state.context.scope = "A范围"; save()');
  app.run('openProject(' + JSON.stringify(b.id) + ')');
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.run('state.context.project'), 'SHIP-B');
  assert.equal(app.run('state.context.scope'), '');
  setItems(app, [{id: 'check-b', category: 'test', title: '只属于B的测试', actual: 'B实际结果'}]);
  app.run('state.context.scope = "B范围"; save()');
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  assert.equal(app.run('state.items.length'), 1);
  assert.equal(app.run('state.items[0].id'), 'check-a');
  assert.equal(app.run('state.context.scope'), 'A范围');
  const savedB = app.snapshot('projectManager.get(' + JSON.stringify(b.id) + ')');
  assert.equal(savedB.items[0].id, 'check-b');
  assert.equal(savedB.context.scope, 'B范围');
});

test('returning home removes reconciliation text, maps, filters, editor and undo from the next project', () => {
  const app = boot(null);
  const a = createFolder(app, '清理验证A', {}, [{id: 'check-a', category: 'test', title: 'A测试', status: '待处理'}]);
  const b = createFolder(app, '清理验证B');
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  clickAction(app, 'quickPass', 'check-a');
  assert.equal(typeof app.document.getElementById('toastUndo').onclick, 'function');
  const toastTimer = app.run('toast._t');
  reconcile(app, '流程号\t金额\nONLY-A\t2', '流程号\t金额\nONLY-A\t2');
  app.run('autoTimer = setTimeout(refreshAutoMap, 250); editingId = "check-a"; state.filter.q = "ONLY-A"; state.filter.onlyOpen = true');
  const autoTimer = app.run('autoTimer');
  app.document.getElementById('overlay').hidden = false;
  app.document.getElementById('autoOverlay').hidden = false;
  app.document.getElementById('fQ').value = 'ONLY-A';
  app.document.getElementById('fOpen').checked = true;
  app.run('showProjectHome()');
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.run('autoResult'), null);
  assert.equal(app.run('editingId'), null);
  assert.equal(app.document.getElementById('autoSrc').value, '');
  assert.equal(app.document.getElementById('autoSys').value, '');
  assert.equal(app.document.getElementById('autoMap').innerHTML, '');
  assert.equal(app.document.getElementById('autoRes').innerHTML, '');
  assert.equal(app.document.autoWrite.disabled, true);
  assert.equal(app.document.getElementById('toastUndo').onclick, null);
  assert.equal(app.timers.has(toastTimer), false);
  assert.equal(app.timers.has(autoTimer), false);
  assert.equal(app.document.getElementById('overlay').hidden, true);
  assert.equal(app.document.getElementById('autoOverlay').hidden, true);
  app.run('openProject(' + JSON.stringify(b.id) + ')');
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.run('state.filter.q'), '');
  assert.equal(app.run('state.filter.onlyOpen'), false);
  assert.equal(app.document.getElementById('fQ').value, '');
  assert.equal(app.document.getElementById('fOpen').checked, false);
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').items[0].status, '通过');
});

test('project backups contain only the current project, its name and compatible top-level data', () => {
  const app = boot(null);
  const a = createFolder(app, '导出项目A', {project: 'SHIP-A'}, [{id: 'a-only', title: 'A项'}]);
  const b = createFolder(app, '导出项目B', {project: 'SHIP-B'}, [{id: 'b-only', title: 'B项'}]);
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  const backup = app.snapshot('projectBackupData()');
  assert.equal(backup.version, 3);
  assert.equal(backup.project.id, a.id);
  assert.equal(backup.project.name, '导出项目A');
  assert.equal(backup.project.items[0].id, 'a-only');
  assert.deepEqual(backup.items, backup.project.items);
  assert.deepEqual(backup.context, backup.project.context);
  assert.equal(JSON.stringify(backup).includes('b-only'), false);
  assert.equal(JSON.stringify(backup).includes(b.id), false);
  app.run('backupJson()');
  const download = app.document.downloads.at(-1);
  assert.ok(download.name.includes('导出项目A'));
  const exported = JSON.parse(download.blob.content);
  assert.equal(exported.project.name, '导出项目A');
  assert.equal(exported.items[0].id, 'a-only');
  assert.equal(JSON.stringify(exported).includes('b-only'), false);
});

test('importing an old backup creates and opens a new folder without replacing the current project', () => {
  const app = boot(null);
  const a = createFolder(app, '导入前项目', {project: 'SHIP-A'}, [{id: 'a-stays', title: 'A原记录'}]);
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  const imported = app.snapshot('importProjectData(' + JSON.stringify({app: 'launch-check-assistant', version: 2,
    context: {project: 'SHIP-IMPORTED', version: 'import-v2'}, items: [{id: 'import-check', title: '导入记录', status: '进行中'}]}) + ')');
  assert.notEqual(imported.id, a.id);
  assert.equal(app.run('activeProjectId'), imported.id);
  assert.equal(app.run('state.items[0].id'), 'import-check');
  assert.equal(app.run('state.context.project'), 'SHIP-IMPORTED');
  assert.equal(app.snapshot('projectManager.list()').length, 2);
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').items[0].id, 'a-stays');
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').context.project, 'SHIP-A');
});

test('workspace actions on the home screen cannot mutate folders, reveal checks or export another project', () => {
  const app = boot({v: 2, items: [{id: 'old', category: 'data', title: '旧项目保留'}], context: {project: 'OLD'}});
  const before = app.storage.get(PROJECTS_STORE_KEY);
  app.document.getElementById('templateSelect').value = 'company-settlement';
  for (const act of ['addTemplate', 'add', 'edit', 'quickPass', 'del', 'save', 'backup', 'report', 'clearExample', 'auto', 'autoRun', 'autoWrite']) {
    clickAction(app, act, 'old');
  }
  for (const input of app.document.contextInputs) { input.value = '不应写入旧项目'; input.emit('input'); }
  assert.equal(app.run('save()'), false);
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.storage.get(PROJECTS_STORE_KEY), before);
  assert.equal(app.document.downloads.length, 0);
  assert.equal(app.document.getElementById('overlay').hidden, true);
  assert.equal(app.document.getElementById('autoOverlay').hidden, true);
  assert.throws(() => app.run('projectBackupData()'), /请先选择项目/);
  assert.throws(() => app.run('buildReport()'), /请先选择项目/);
});

test('a late file-import callback is cancelled after a project switch without discarding new-project work', () => {
  const app = boot(null);
  const a = createFolder(app, '异步导入项目A', {project: 'A'}, [{id: 'a-only', title: 'A项'}]);
  const b = createFolder(app, '异步导入项目B', {project: 'B'}, [{id: 'b-only', title: 'B项'}]);
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  const fileInput = app.document.getElementById('fileInput');
  fileInput.files = [{name: 'old-project.json'}];
  fileInput.emit('change');
  assert.equal(app.fileReaders.length, 1);
  app.run('openProject(' + JSON.stringify(b.id) + ')');
  app.document.getElementById('autoSrc').value = 'B项目尚未执行核对的临时明细';
  app.document.getElementById('modalBody').innerHTML = '<textarea>B项目正在编辑的内容</textarea>';
  const reader = app.fileReaders[0];
  reader.result = JSON.stringify({version: 2, items: [{id: 'imported-only', title: '导入项'}], context: {project: 'IMPORTED'}});
  reader.readyState = 2;
  reader.onload();
  assert.equal(app.run('state.items[0].id'), 'b-only');
  assert.equal(app.run('activeProjectId'), b.id);
  assert.equal(app.snapshot('projectManager.list()').length, 2);
  assert.equal(app.document.getElementById('autoSrc').value, 'B项目尚未执行核对的临时明细');
  assert.match(app.document.getElementById('modalBody').innerHTML, /B项目正在编辑的内容/);
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').items[0].id, 'a-only');
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(b.id) + ')').items[0].id, 'b-only');
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(b.id) + ')').context.project, 'B');
  assert.equal(fileInput.value, '');
});

test('a file import that finishes in the same project session still opens an independent new folder', () => {
  const app = boot(null);
  const a = createFolder(app, '当前正常导入项目', {project: 'A'}, [{id: 'a-safe', title: 'A保留项'}]);
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  const fileInput = app.document.getElementById('fileInput');
  fileInput.files = [{name: 'project-backup.json'}];
  fileInput.value = 'C:\\fakepath\\project-backup.json';
  fileInput.emit('change');
  const reader = app.fileReaders[0];
  reader.result = JSON.stringify({version: 2, items: [{id: 'import-success', title: '成功导入'}], context: {project: 'IMPORT'}});
  reader.readyState = 2;
  reader.onload();
  assert.notEqual(app.run('activeProjectId'), a.id);
  assert.equal(app.run('state.items[0].id'), 'import-success');
  assert.equal(app.run('state.context.project'), 'IMPORT');
  assert.equal(app.snapshot('projectManager.list()').length, 2);
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').items[0].id, 'a-safe');
  assert.equal(fileInput.value, '');
});

test('file read failure resets the picker and reports failure without creating a project', () => {
  const app = boot(null);
  const fileInput = app.document.getElementById('fileInput');
  fileInput.files = [{name: 'unreadable.json'}];
  fileInput.value = 'C:\\fakepath\\unreadable.json';
  fileInput.emit('change');
  const reader = app.fileReaders[0];
  assert.equal(typeof reader.onerror, 'function');
  reader.readyState = 2;
  reader.onerror();
  assert.equal(fileInput.value, '');
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('projectManager.list()'), []);
  assert.match(app.document.getElementById('toastMsg').textContent, /读取备份文件失败/);
});

test('storage failure keeps unsaved work in its project and still allows a complete project backup', () => {
  const app = boot(null);
  const a = createFolder(app, '保存失败项目A', {project: 'A'}, [{id: 'old-a', title: 'A旧项'}]);
  const b = createFolder(app, '保存失败项目B', {project: 'B'}, [{id: 'b-safe', title: 'B项'}]);
  app.run('openProject(' + JSON.stringify(a.id) + ')');
  setItems(app, [{id: 'unsaved-a', title: 'A尚未保存的新项'}]);
  app.failures.write = true;
  assert.equal(app.run('save()'), false);
  assert.equal(app.run('projectDirty'), true);
  assert.equal(app.run('openProject(' + JSON.stringify(b.id) + ')'), false);
  assert.equal(app.run('showProjectHome()'), false);
  assert.equal(app.run('activeProjectId'), a.id);
  assert.equal(app.run('state.items[0].id'), 'unsaved-a');
  const backup = app.snapshot('projectBackupData()');
  assert.equal(backup.project.name, '保存失败项目A');
  assert.equal(backup.items[0].id, 'unsaved-a');
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(b.id) + ')').items[0].id, 'b-safe');
  app.run('backupJson()');
  assert.equal(JSON.parse(app.document.downloads.at(-1).blob.content).items[0].id, 'unsaved-a');
  app.failures.write = false;
  assert.equal(app.run('save()'), true);
  assert.equal(app.run('showProjectHome()'), true);
  assert.equal(app.run('activeProjectId'), null);
  assert.equal(app.snapshot('projectManager.get(' + JSON.stringify(a.id) + ')').items[0].id, 'unsaved-a');
});

test('retrying a new check after failed storage updates the same unsaved item instead of duplicating it', () => {
  const app = workBoot();
  app.run('openModal(null, "data")');
  const title = app.document.querySelector('#modalBody [name="f_title"]');
  assert.ok(title, 'the real form should expose its new-check title field');
  title.value = '本地存储失败后重试的核对项';
  app.failures.write = true;
  app.run('submitForm()');
  assert.equal(app.run('state.items.length'), 1);
  const firstId = app.run('state.items[0].id');
  assert.equal(app.run('editingId'), firstId);
  assert.equal(app.run('projectDirty'), true);
  assert.equal(app.document.getElementById('overlay').hidden, false);
  assert.equal(activeSavedProject(app).items.length, 0);
  title.value = '恢复存储后修改并重试同一项';
  app.failures.write = false;
  app.run('submitForm()');
  assert.equal(app.run('state.items.length'), 1);
  assert.equal(app.run('state.items[0].id'), firstId);
  assert.equal(app.run('state.items[0].title'), '恢复存储后修改并重试同一项');
  assert.equal(activeSavedProject(app).items.length, 1);
  assert.equal(activeSavedProject(app).items[0].id, firstId);
  assert.equal(app.run('projectDirty'), false);
  assert.equal(app.document.getElementById('overlay').hidden, true);
});

test('retrying a newly written reconciliation after failed storage keeps one target check', () => {
  const app = workBoot();
  app.run('openAuto()');
  reconcile(app, '流程号\t金额\nRETRY-F01\t12.5', '流程号\t金额\nRETRY-F01\t12.5');
  assert.equal(app.document.getElementById('autoTarget').value, 'new');
  app.failures.write = true;
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 1);
  const firstId = app.run('state.items[0].id');
  assert.equal(app.document.getElementById('autoTarget').value, firstId);
  assert.equal(activeSavedProject(app).items.length, 0);
  assert.equal(app.document.getElementById('autoOverlay').hidden, false);
  app.failures.write = false;
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 1);
  assert.equal(app.run('state.items[0].id'), firstId);
  assert.equal(activeSavedProject(app).items.length, 1);
  assert.equal(activeSavedProject(app).items[0].id, firstId);
  assert.equal(activeSavedProject(app).items[0].posSum, '12.5');
  assert.equal(app.document.getElementById('autoOverlay').hidden, true);
});

test('a blocked localStorage getter still reaches the home screen without seeding or overwriting records', () => {
  const old = {v: 2, items: [{id: 'legacy-safe', title: '未获存储权限前必须保留的旧记录'}], context: {project: 'DEMO-SAFE'}};
  const app = boot(old, undefined, {storageAccessError: true});
  assert.equal(app.run('activeProjectId'), null);
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.deepEqual(app.snapshot('state.context'), {project: '', version: '', cutoff: '', scope: ''});
  assert.equal(app.document.getElementById('projectHomeView').hidden, false);
  assert.equal(app.document.getElementById('workspaceView').hidden, true);
  assert.equal(app.document.getElementById('workspaceActions').hidden, true);
  assert.equal(app.document.getElementById('projectStorageMessage').hidden, false);
  assert.match(app.document.getElementById('projectStorageMessage').textContent, /原记录未被覆盖|原始记录已保留/);
  assert.equal(app.storage.get(LEGACY_STORE_KEY), JSON.stringify(old));
  assert.equal(app.storage.has(PROJECTS_STORE_KEY), false);
});

test('saved empty project remains empty when explicitly reopened after a fresh startup', () => {
  const app = workBoot({v: 2, items: [], context: {project: 'DEMO-SHIP-EMPTY'}});
  assert.deepEqual(app.snapshot('state.items'), []);
  assert.equal(app.run('stats().reviewState'), 'insufficient');
  app.run('save()');
  const reloaded = workBoot(null, app.storage);
  assert.deepEqual(reloaded.snapshot('state.items'), []);
  assert.equal(reloaded.run('state.context.project'), 'DEMO-SHIP-EMPTY');
  assert.equal(reloaded.document.getElementById('exampleBanner').hidden, true);
  assert.match(reloaded.document.getElementById('verdict').innerHTML, /尚无可评审的有效检查项/);
});

test('v1 local records migrate without field loss and leave the original snapshot intact', () => {
  const original = {id: 'legacy-check', category: 'data', title: '旧版本核对记录', status: '进行中',
    note: '保留原核查范围', owner: '测试角色', detailCount: '7', evidence: '已有核对记录.pdf', customField: '保留'};
  const app = workBoot({v: 1, items: [original]});
  const loaded = app.snapshot('state.items[0]');
  for (const [key, value] of Object.entries(original)) assert.equal(loaded[key], value, key);
  assert.deepEqual(app.snapshot('state.context'), {project: '', version: '', cutoff: '', scope: ''});
  app.run('save()');
  const saved = activeSavedProject(app);
  assert.equal(saved.items[0].id, original.id);
  assert.equal(saved.items[0].customField, original.customField);
  assert.deepEqual(saved.context, {project: '', version: '', cutoff: '', scope: ''});
  const legacy = JSON.parse(app.storage.get(LEGACY_STORE_KEY));
  assert.equal(legacy.v, 1);
  assert.equal(legacy.items[0].customField, original.customField);
});

test('context input saves immediately and appears in the report without blur or change', () => {
  const app = workBoot();
  const values = {project: 'DEMO-SHIP-INPUT', version: 'TEST-INPUT-v2',
    cutoff: '2026-11-10 15:00', scope: '  专业H / 测试工程范围  '};
  for (const input of app.document.contextInputs) {
    input.value = values[input.dataset.context];
    input.emit('input');
    const saved = activeSavedProject(app);
    assert.equal(saved.context[input.dataset.context], input.value.trim());
  }
  assert.equal(app.run('state.context.scope'), '专业H / 测试工程范围');
  const report = app.run('buildReport()');
  assert.match(report, /项目 \/ 工程：DEMO-SHIP-INPUT/);
  assert.match(report, /拟上线版本：TEST-INPUT-v2/);
  assert.match(report, /取数截止：2026-11-10 15:00/);
  assert.match(report, /核查范围：专业H \/ 测试工程范围/);
  const reloaded = workBoot(null, app.storage);
  assert.equal(reloaded.run('state.context.scope'), '专业H / 测试工程范围');
  assert.equal(reloaded.document.contextInputs.find(input => input.dataset.context === 'scope').value,
    '专业H / 测试工程范围');
});

test('adding a repair template twice appends once and preserves all existing work', () => {
  const app = workBoot();
  const old = {id: 'existing', category: 'data', title: '已有检查', status: '通过', critical: true,
    owner: '测试角色', note: '已有人工结论', evidence: '已有验收记录.pdf', project: 'DEMO-SHIP-OLD'};
  setItems(app, [old]);
  const before = app.snapshot('state.items[0]');
  app.document.getElementById('templateSelect').value = 'company-settlement';
  app.run('addTemplate(); addTemplate()');
  const items = app.snapshot('state.items');
  const count = app.run('window.SHIPREPAIR_TEMPLATES.find(t => t.id === "company-settlement").items.length');
  assert.equal(items.length, count + 1);
  assert.deepEqual(items[0], before);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.equal(new Set(items.slice(1).map(item => item.templateKey)).size, count);
  for (const item of items.slice(1)) {
    assert.equal(item.status, '待处理');
    assert.equal(item.owner, '');
    assert.equal(item.due, '');
    assert.equal(item.evidence, '');
    assert.equal(item.example, false);
  }
  assert.equal(activeSavedProject(app).items.length, count + 1);
});

test('report includes restored context, escaped evidence and real blockers with effective category totals', () => {
  const app = workBoot({v: 2, items: [], context: {project: 'DEMO-<SHIP>', version: 'TEST-v2',
    cutoff: '2026-11-10 12:00', scope: '工程A & 专业H'}});
  setItems(app, [
    {id: 'confirmed', category: 'rule', title: '有效口径', critical: true, status: '通过',
      confirmOwner: '测试业务角色', basis: '本项目确认单第1条', evidence: '验收&记录.pdf'},
    {id: 'unconfirmed', category: 'rule', title: '缺少确认的口径', critical: true, status: '通过',
      basis: '待填写本项目确认依据', evidence: ''},
    {id: 'untested', category: 'test', title: '未记录实际结果', critical: true, status: '通过',
      expected: '来源与目标一致', actual: '', evidence: '测试附件.pdf'}
  ]);
  const report = app.run('buildReport()');
  assert.match(report, /项目 \/ 工程：DEMO-&lt;SHIP&gt;/);
  assert.match(report, /拟上线版本：TEST-v2/);
  assert.match(report, /取数截止：2026-11-10 12:00/);
  assert.match(report, /核查范围：工程A &amp; 专业H/);
  assert.match(report, /验收证据：验收&amp;记录\.pdf/);
  assert.match(report, /关键业务规则缺少业务确认人/);
  assert.match(report, /关键业务规则缺少有效确认依据/);
  assert.match(report, /核心测试缺少实际结果/);
  assert.match(report, /业务规则确认<span class="cnt">2 项 · 有效通过 1<\/span>/);
  assert.match(report, /关键测试<span class="cnt">1 项 · 有效通过 0<\/span>/);
  assert.match(report, /暂不具备上线条件/);
  assert.equal(app.run('stats().pass'), 1);
  assert.equal(app.run('stats().blockers.length'), 2);
});

test('source-only analysis writes source statistics, decimal rounding and unknown target counts honestly', () => {
  const app = workBoot();
  reconcile(app, '流程号\t金额\nF-1\t1.005\nF-2\t-0.005\nF-3\t0\nF-4\t\nF-5\t非法数值');
  assert.equal(app.run('autoResult.src.rows'), 5);
  assert.equal(app.run('autoResult.sys.rows'), 0);
  assert.equal(app.run('autoResult.src.empty'), 1);
  assert.equal(app.run('autoResult.src.invalid'), 1);
  assert.equal(app.run('autoResult.src.zero'), 1);
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.detailCount, '5');
  assert.equal(item.summaryCount, '', 'no target table is unknown, not zero');
  assert.equal(item.posSum, '1.01');
  assert.equal(item.negSum, '-0.01');
  assert.equal(item.zeroCount, '1');
  assert.equal(item.status, '进行中');
  assert.equal(item.reconciliation.both, false);
  assert.equal(item.reconciliation.issues, 2);
  assert.match(item.note, /仅单份数据，未核对两边一致性/);
  assert.match(item.note, /未选列，未核查/);
  assert.equal(activeSavedProject(app).items[0].posSum, '1.01');
});

test('target-only analysis does not invent a source count or overwrite statistics with empty-side zero', () => {
  const app = workBoot();
  reconcile(app, '', '流程号\t金额\nF-1\t6.5\nF-2\t-1.25');
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.detailCount, '');
  assert.equal(item.summaryCount, '2');
  assert.equal(item.posSum, '6.5');
  assert.equal(item.negSum, '-1.25');
  assert.equal(item.reconciliation.both, false);
});

test('typing new data invalidates previous analysis before delayed map refresh or write', () => {
  const app = workBoot();
  reconcile(app, '流程号\t金额\nF-1\t2');
  const input = app.document.getElementById('autoSrc');
  input.value = '流程号\t金额\nF-1\t99';
  input.emit('input');
  assert.equal(app.run('autoResult'), null);
  assert.equal(app.document.autoWrite.disabled, true);
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.match(app.document.getElementById('autoErr').textContent, /重新核对/);
});

test('changing a mapping invalidates analysis and cannot write a stale result', () => {
  const app = workBoot();
  reconcile(app, '流程号\t金额\t工程编号\nF-1\t2\tDEMO-SHIP-001');
  const mapping = app.document.getElementById('map_src_project');
  mapping.value = '-1';
  app.document.getElementById('autoMap').emit('change', mapping);
  assert.equal(app.run('autoResult'), null);
  assert.equal(app.document.autoWrite.disabled, true);
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.match(app.document.getElementById('autoErr').textContent, /重新核对/);
});

test('write fingerprints reject changed values even without an input event', () => {
  const app = workBoot();
  reconcile(app, '流程号\t金额\nF-1\t2');
  app.document.getElementById('autoSrc').value = '流程号\t金额\nF-1\t3';
  app.run('writeAutoResult()');
  assert.equal(app.run('state.items.length'), 0);
  assert.equal(app.run('autoResult'), null);
  assert.match(app.document.getElementById('autoErr').textContent, /数据或列对应已变化/);
});

test('writing new analysis to an existing passed item reopens it and preserves manual untested scope', () => {
  const app = workBoot();
  setItems(app, [{id: 'existing-data', category: 'data', title: '已验收的核对记录', status: '通过', critical: true,
    note: '原人工备注：仅核对特定工程', evidence: '原验收证据.pdf', owner: '测试角色',
    project: 'DEMO-SHIP-OLD', dept: '原专业', period: '原期间', team: '原施工队'}]);
  reconcile(app, '流程号\t金额\nF-1\t7', '流程号\t金额\nF-1\t7');
  app.document.getElementById('autoTarget').value = 'existing-data';
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(app.run('state.items.length'), 1);
  assert.equal(item.id, 'existing-data');
  assert.equal(item.status, '进行中');
  assert.equal(item.detailCount, '1');
  assert.equal(item.summaryCount, '1');
  assert.match(item.note, /^原人工备注：仅核对特定工程\n\n自动核对 /);
  assert.match(item.note, /未选列，未核查/);
  assert.equal(item.project, 'DEMO-SHIP-OLD');
  assert.equal(item.dept, '原专业');
  assert.equal(item.period, '原期间');
  assert.equal(item.team, '原施工队');
  assert.equal(item.evidence, '原验收证据.pdf');
  assert.equal(item.owner, '测试角色');
  assert.equal(item.reconciliation.both, true);
  assert.equal(item.reconciliation.issues, 0);
  assert.deepEqual(item.reconciliation.ranges, {src: {}, sys: {}});
});

test('written reconciliation retains every selected scope value and flags blank selected dimensions', () => {
  const app = workBoot();
  const source = '流程号\t金额\t工程编号\t专业\t期间\t施工队\t明细行号\n' +
    'F-1\t2\tDEMO-SHIP-001\tH\t2026-10\tTEST-TEAM-A\t1\n' +
    'F-2\t3\tDEMO-SHIP-002\tE\t2026-11\tTEST-TEAM-B\t2\n' +
    'F-3\t4\tDEMO-SHIP-002\t\t2026-11\tTEST-TEAM-B\t3';
  reconcile(app, source, source);
  assert.equal(app.run('autoResult.src.missingDimensions'), 1);
  assert.equal(app.run('autoResult.sys.missingDimensions'), 1);
  assert.ok(app.run('autoResult.issues') >= 2, 'missing selected dimensions must count as unresolved quality issues');
  app.run('writeAutoResult()');
  const item = app.snapshot('state.items[0]');
  assert.equal(item.project, '多个（见核对备注）');
  for (const side of ['src', 'sys']) {
    assert.deepEqual(item.reconciliation.ranges[side].project, ['DEMO-SHIP-001', 'DEMO-SHIP-002']);
    assert.deepEqual(item.reconciliation.ranges[side].dept, ['H', 'E', '']);
    assert.deepEqual(item.reconciliation.ranges[side].period, ['2026-10', '2026-11']);
    assert.deepEqual(item.reconciliation.ranges[side].team, ['TEST-TEAM-A', 'TEST-TEAM-B']);
    assert.deepEqual(item.reconciliation.ranges[side].line, ['1', '2', '3']);
  }
  for (const value of ['DEMO-SHIP-001', 'DEMO-SHIP-002', 'TEST-TEAM-A', 'TEST-TEAM-B', '2026-10', '2026-11']) {
    assert.ok(item.note.includes(value), 'scope must remain available in exported notes: ' + value);
  }
  assert.match(item.note, /（空）/);
  const report = app.run('buildReport()');
  assert.match(report, /DEMO-SHIP-001/);
  assert.match(report, /DEMO-SHIP-002/);
});
