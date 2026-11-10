'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ProjectStore = require('../assets/projects.js');

function storage(initial) {
  const memory = new Map(Object.entries(initial || {}));
  return {memory: memory, getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, String(value))};
}
function check(id) { return {id: id, category: 'data', title: '脱敏检查 ' + id, status: '待处理'}; }

test('an empty project list does not seed records or remember an active folder', () => {
  const local = storage();
  const manager = ProjectStore.createManager(local);
  assert.deepEqual(manager.list(), []);
  assert.deepEqual(manager.migrateLegacy(), {migrated: false, project: null});
  assert.equal(local.memory.size, 0);
  const created = manager.create({name: '项目甲'});
  assert.deepEqual(created.items, []);
  assert.deepEqual(created.context, {project: '', version: '', cutoff: '', scope: ''});
  assert.deepEqual(Object.keys(JSON.parse(local.getItem(ProjectStore.STORE_KEY))).sort(), ['projects', 'v']);
  const fresh = ProjectStore.createManager(local);
  assert.equal(fresh.list().length, 1);
  assert.equal(fresh.activeProject, undefined);
  assert.equal(fresh.activeProjectId, undefined);
});

test('project records and returned snapshots are isolated from other folders', () => {
  const manager = ProjectStore.createManager(storage());
  const spec = {name: '项目甲', items: [check('a')], context: {project: 'DEMO-A', version: '1.0'}};
  const a = manager.create(spec);
  const b = manager.create({name: '项目乙', items: [check('b')], context: {project: 'DEMO-B'}});
  spec.items[0].title = '外部修改';
  a.items[0].title = '返回值修改';
  const changed = manager.save(a.id, {items: [Object.assign(check('a'), {status: '通过'})], context: {scope: '仅甲'}});
  assert.equal(changed.context.project, 'DEMO-A');
  assert.equal(changed.context.version, '1.0');
  assert.equal(changed.context.scope, '仅甲');
  assert.equal(manager.get(b.id).items[0].status, '待处理');
  assert.equal(manager.get(b.id).context.project, 'DEMO-B');
  const list = manager.list();
  list[0].items.length = 0;
  assert.equal(manager.get(a.id).items.length, 1);
  assert.equal(manager.get('missing'), null);
});

test('separate managers re-read fresh storage when saving different projects', () => {
  const local = storage();
  const first = ProjectStore.createManager(local);
  const second = ProjectStore.createManager(local);
  const a = first.create({name: '甲'});
  const b = second.create({name: '乙'});
  const staleA = first.get(a.id);
  const staleB = second.get(b.id);
  first.save(staleA.id, {items: [check('a')]});
  second.save(staleB.id, {items: [check('b')]});
  assert.equal(first.get(a.id).items[0].id, 'a');
  assert.equal(first.get(b.id).items[0].id, 'b');
  first.save(a.id, {context: {scope: '甲范围'}});
  second.save(b.id, {context: {scope: '乙范围'}});
  assert.equal(first.get(a.id).context.scope, '甲范围');
  assert.equal(first.get(b.id).context.scope, '乙范围');
});

test('migration preserves old records and their original key and only runs once', () => {
  const legacy = JSON.stringify({v: 2, items: [check('old')], context: {project: 'DEMO-OLD', cutoff: '模拟时点'}});
  const local = storage({[ProjectStore.LEGACY_KEY]: legacy});
  const manager = ProjectStore.createManager(local);
  const result = manager.migrateLegacy();
  assert.equal(result.migrated, true);
  assert.equal(result.project.id, 'legacy-v1');
  assert.equal(result.project.name, '历史项目 · DEMO-OLD');
  assert.equal(result.project.items[0].id, 'old');
  assert.equal(result.project.context.cutoff, '模拟时点');
  assert.equal(local.getItem(ProjectStore.LEGACY_KEY), legacy);
  manager.save(result.project.id, {items: []});
  const repeated = manager.migrateLegacy();
  assert.equal(repeated.migrated, false);
  assert.deepEqual(repeated.project.items, []);
  assert.equal(manager.list().length, 1);
  assert.equal(local.getItem(ProjectStore.LEGACY_KEY), legacy);
});

test('an explicitly empty old ledger migrates as an empty folder without demonstrations', () => {
  const local = storage({[ProjectStore.LEGACY_KEY]: JSON.stringify({v: 1, items: []})});
  const result = ProjectStore.createManager(local).migrateLegacy();
  assert.equal(result.migrated, true);
  assert.equal(result.project.name, '历史项目');
  assert.deepEqual(result.project.items, []);
});

test('bad or unknown-version stores are not replaced or silently reset', () => {
  for (const raw of ['', '{bad', 'null', JSON.stringify({v: 99, projects: []}), JSON.stringify({v: 1, projects: [{}]})]) {
    const local = storage({[ProjectStore.STORE_KEY]: raw});
    const manager = ProjectStore.createManager(local);
    assert.throws(() => manager.list());
    assert.throws(() => manager.create({name: '新项目'}));
    assert.equal(local.getItem(ProjectStore.STORE_KEY), raw);
  }
  for (const raw of ['{bad', JSON.stringify({v: 99, items: []}), JSON.stringify({items: 'bad'})]) {
    const local = storage({[ProjectStore.LEGACY_KEY]: raw});
    assert.throws(() => ProjectStore.createManager(local).migrateLegacy());
    assert.equal(local.getItem(ProjectStore.LEGACY_KEY), raw);
    assert.equal(local.getItem(ProjectStore.STORE_KEY), null);
  }
});

test('a storage write failure keeps prior folders and does not mutate caller snapshots', () => {
  const local = storage();
  const manager = ProjectStore.createManager(local);
  const a = manager.create({name: '甲', items: [check('a')]});
  const before = local.getItem(ProjectStore.STORE_KEY);
  local.setItem = () => { throw new Error('quota'); };
  assert.throws(() => manager.save(a.id, {items: [check('changed')]}), /quota/);
  assert.throws(() => manager.create({name: '乙'}), /quota/);
  assert.equal(local.getItem(ProjectStore.STORE_KEY), before);
  assert.equal(a.items[0].id, 'a');
  assert.equal(manager.get(a.id).items[0].id, 'a');
});

test('migration failure leaves the original old ledger available for retry', () => {
  const legacy = JSON.stringify({items: [check('old')]});
  const local = storage({[ProjectStore.LEGACY_KEY]: legacy});
  local.setItem = () => { throw new Error('quota'); };
  assert.throws(() => ProjectStore.createManager(local).migrateLegacy(), /quota/);
  assert.equal(local.getItem(ProjectStore.LEGACY_KEY), legacy);
  assert.equal(local.getItem(ProjectStore.STORE_KEY), null);
});

test('project names are required, bounded and unique after trimming and case folding', () => {
  const manager = ProjectStore.createManager(storage());
  const a = manager.create({name: '  DEMO-A  '});
  const b = manager.create({name: 'DEMO-B'});
  assert.equal(a.name, 'DEMO-A');
  for (const value of ['', '   ', 12, '甲'.repeat(101)]) assert.throws(() => manager.create({name: value}));
  assert.throws(() => manager.create({name: ' demo-a '}), /同名/);
  assert.throws(() => manager.save(b.id, {name: 'demo-a'}), /同名/);
  assert.equal(manager.get(b.id).name, 'DEMO-B');
  assert.throws(() => manager.save('missing', {items: []}), /不存在/);
});

test('imports always create independent folders rather than overwrite matching ids or names', () => {
  const manager = ProjectStore.createManager(storage());
  const original = manager.create({name: 'DEMO-A', items: [check('original')]});
  const imported = manager.importProject({app: 'launch-check-assistant', version: 3,
    project: Object.assign({}, original, {items: [check('imported')]}), items: [check('wrong-fallback')]});
  assert.notEqual(imported.id, original.id);
  assert.equal(imported.name, 'DEMO-A (2)');
  assert.equal(imported.items[0].id, 'imported');
  assert.equal(manager.get(original.id).items[0].id, 'original');
  const third = manager.importProject({app: 'launch-check-assistant', version: 2, items: [], context: {project: 'DEMO-A'}});
  assert.equal(third.name, 'DEMO-A (3)');
  assert.deepEqual(third.items, []);
  assert.equal(manager.list().length, 3);
});

test('old array and v1 backups import while unrelated or future files fail without changes', () => {
  const local = storage();
  const manager = ProjectStore.createManager(local);
  const a = manager.importProject([check('array')]);
  const b = manager.importProject({app: 'launch-check-assistant', version: 1, items: [check('v1')]}, {name: '手动命名'});
  assert.equal(a.name, '导入项目');
  assert.equal(b.name, '手动命名');
  const before = local.getItem(ProjectStore.STORE_KEY);
  for (const input of [null, {app: 'other', items: []}, {version: 99, items: []}, {items: [null]}, {items: 'bad'}, {version: 3, project: 'bad'}]) {
    assert.throws(() => manager.importProject(input));
    assert.equal(local.getItem(ProjectStore.STORE_KEY), before);
  }
});

test('item extensions are preserved while nulls, arrays and non-record objects are rejected', () => {
  const manager = ProjectStore.createManager(storage());
  const original = Object.assign(check('extended'), {custom: {workflow: 'SIM-F01'}, reconciliation: {issues: 0, both: true}});
  const created = manager.create({name: '扩展字段', items: [original], context: {version: 2, project: null, scope: false}});
  assert.deepEqual(created.items[0].custom, {workflow: 'SIM-F01'});
  assert.deepEqual(created.items[0].reconciliation, {issues: 0, both: true});
  assert.deepEqual(created.context, {project: '', version: '2', cutoff: '', scope: 'false'});
  for (const invalid of [null, [], new Date(), /test/]) assert.throws(() => manager.create({name: '无效', items: [invalid]}));
  assert.throws(() => manager.create({name: '无效范围', context: []}));
});

test('browser export works offline without CommonJS or storage selection side effects', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/projects.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.ProjectStore.createManager, 'function');
  const local = storage();
  const manager = sandbox.ProjectStore.createManager(local);
  manager.create({name: '离线项目'});
  const stored = JSON.parse(local.getItem(ProjectStore.STORE_KEY));
  assert.equal(stored.projects.length, 1);
  assert.equal('activeProjectId' in stored, false);
});
