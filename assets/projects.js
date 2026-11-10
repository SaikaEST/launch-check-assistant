/* Project folders are local records. No project is automatically selected. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProjectStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORE_KEY = 'launch-check-projects-v1';
  const LEGACY_KEY = 'launch-check-assistant-v1';
  const CONTEXT_KEYS = ['project', 'version', 'cutoff', 'scope'];
  const MAX_NAME_LENGTH = 100;
  let sequence = 0;

  function object(value) {
    return value !== null && Object.prototype.toString.call(value) === '[object Object]';
  }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function name(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('请填写项目文件夹名称');
    const result = value.trim();
    if (result.length > MAX_NAME_LENGTH) throw new Error('项目文件夹名称不能超过 100 个字符');
    return result;
  }
  function folded(value) { return value.trim().toLocaleLowerCase(); }
  function context(value, previous) {
    if (value !== undefined && !object(value)) throw new Error('项目范围格式不正确');
    const result = {};
    CONTEXT_KEYS.forEach(function (key) {
      const candidate = value && own(value, key) ? value[key] : previous && previous[key];
      if (candidate != null && !['string', 'number', 'boolean'].includes(typeof candidate)) throw new Error('项目范围字段格式不正确：' + key);
      result[key] = candidate == null ? '' : String(candidate);
    });
    return result;
  }
  function items(value) {
    if (!Array.isArray(value) || value.some(function (item) { return !object(item); })) {
      throw new Error('检查项格式不正确，应为对象数组');
    }
    return clone(value);
  }
  function uniqueName(requested, projects) {
    const base = name(requested);
    let result = base, index = 2;
    while (projects.some(function (project) { return folded(project.name) === folded(result); })) {
      const suffix = ' (' + index++ + ')';
      result = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    }
    return result;
  }
  function uniqueId(projects) {
    let result;
    do {
      result = 'p-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    } while (projects.some(function (project) { return project.id === result; }));
    return result;
  }

  function createManager(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('浏览器本地存储不可用');
    }

    function read() {
      const raw = storage.getItem(STORE_KEY);
      if (raw == null) return {v: 1, projects: []};
      let data;
      try { data = JSON.parse(raw); }
      catch (error) { throw new Error('项目数据无法解析，原始记录已保留，请先备份后检查'); }
      if (!object(data) || data.v !== 1 || !Array.isArray(data.projects)) {
        throw new Error('项目数据格式或版本不受支持，原始记录已保留');
      }
      const seen = new Set();
      const projects = data.projects.map(function (project) {
        if (!object(project) || typeof project.id !== 'string' || !project.id || seen.has(project.id)) {
          throw new Error('项目标识不正确或重复，原始记录已保留');
        }
        seen.add(project.id);
        if (!Number.isFinite(project.createdAt) || !Number.isFinite(project.updatedAt)) {
          throw new Error('项目时间记录不正确，原始记录已保留');
        }
        return {id: project.id, name: name(project.name), createdAt: project.createdAt, updatedAt: project.updatedAt,
          items: items(project.items), context: context(project.context)};
      });
      return {v: 1, projects: projects};
    }
    function write(data) {
      // Keep all changes local until setItem succeeds; never remove the old key first.
      storage.setItem(STORE_KEY, JSON.stringify({v: 1, projects: data.projects}));
    }
    function append(data, spec, id) {
      const projectName = name(spec.name);
      if (data.projects.some(function (project) { return folded(project.name) === folded(projectName); })) {
        throw new Error('已有同名项目文件夹，请更换名称');
      }
      const now = Date.now();
      const project = {id: id || uniqueId(data.projects), name: projectName, createdAt: now, updatedAt: now,
        items: items(spec.items === undefined ? [] : spec.items), context: context(spec.context)};
      data.projects.push(project);
      write(data);
      return clone(project);
    }

    function list() { return clone(read().projects); }
    function get(id) {
      const project = read().projects.find(function (entry) { return entry.id === id; });
      return project ? clone(project) : null;
    }
    function create(spec) {
      if (!object(spec)) throw new Error('新建项目参数不正确');
      return append(read(), spec);
    }
    function save(id, patch) {
      if (!object(patch)) throw new Error('保存项目参数不正确');
      // Re-read for every mutation so another folder saved in another tab is preserved.
      const data = read();
      const project = data.projects.find(function (entry) { return entry.id === id; });
      if (!project) throw new Error('项目文件夹不存在，未保存任何更改');
      const nextName = own(patch, 'name') ? name(patch.name) : project.name;
      if (data.projects.some(function (entry) { return entry.id !== id && folded(entry.name) === folded(nextName); })) {
        throw new Error('已有同名项目文件夹，请更换名称');
      }
      const nextItems = own(patch, 'items') ? items(patch.items) : project.items;
      const nextContext = own(patch, 'context') ? context(patch.context, project.context) : project.context;
      project.name = nextName;
      project.items = nextItems;
      project.context = nextContext;
      project.updatedAt = Date.now();
      write(data);
      return clone(project);
    }
    function migrateLegacy() {
      const data = read();
      const existing = data.projects.find(function (project) { return project.id === 'legacy-v1'; });
      if (existing) return {migrated: false, project: clone(existing)};
      const raw = storage.getItem(LEGACY_KEY);
      if (raw == null) return {migrated: false, project: null};
      let legacy;
      try { legacy = JSON.parse(raw); }
      catch (error) { throw new Error('旧版台账无法解析，原始记录已保留，未创建或覆盖项目'); }
      if (!object(legacy) || !Array.isArray(legacy.items)) {
        throw new Error('旧版台账格式不正确，原始记录已保留，未创建或覆盖项目');
      }
      if (own(legacy, 'app') && legacy.app !== 'launch-check-assistant') throw new Error('旧版台账不属于本应用，原始记录已保留');
      if (own(legacy, 'v') && ![1, 2].includes(legacy.v)) throw new Error('旧版台账版本不受支持，原始记录已保留');
      if (own(legacy, 'version') && ![1, 2].includes(legacy.version)) throw new Error('旧版台账版本不受支持，原始记录已保留');
      const oldContext = context(legacy.context);
      const requested = ('历史项目' + (oldContext.project.trim() ? ' · ' + oldContext.project.trim() : '')).slice(0, MAX_NAME_LENGTH);
      const project = append(data, {name: uniqueName(requested, data.projects), items: items(legacy.items), context: oldContext}, 'legacy-v1');
      return {migrated: true, project: project};
    }
    function importProject(input, options) {
      const data = read();
      const opts = options || {};
      if (!object(opts)) throw new Error('导入项目参数不正确');
      let source;
      if (Array.isArray(input)) source = {items: input};
      else {
        if (!object(input)) throw new Error('备份文件格式不正确');
        if (own(input, 'app') && input.app !== 'launch-check-assistant') throw new Error('该备份不属于本应用');
        if (own(input, 'version') && ![1, 2, 3].includes(input.version)) throw new Error('备份版本不受支持，请使用兼容版本导入');
        if (own(input, 'v') && ![1, 2].includes(input.v)) throw new Error('备份版本不受支持，请使用兼容版本导入');
        if (own(input, 'project')) {
          if (!object(input.project)) throw new Error('项目备份格式不正确');
          source = input.project;
        } else source = input;
      }
      const importedItems = items(source.items);
      const importedContext = context(source.context);
      const requested = own(opts, 'name') ? name(opts.name) :
        (typeof source.name === 'string' && source.name.trim() ? source.name :
          (importedContext.project.trim() ? importedContext.project.trim() : '导入项目'));
      return append(data, {name: uniqueName(requested, data.projects), items: importedItems, context: importedContext});
    }

    return {list: list, get: get, create: create, save: save, migrateLegacy: migrateLegacy, importProject: importProject};
  }

  return {STORE_KEY: STORE_KEY, LEGACY_KEY: LEGACY_KEY, createManager: createManager};
});
