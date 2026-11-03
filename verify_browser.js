const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('./index.html', 'utf8');

class MockElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      toggle(cls) { if (this._classes.has(cls)) this._classes.delete(cls); else this._classes.add(cls); },
      contains(cls) { return this._classes.has(cls); }
    };
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.dataset = {};
    this.children = [];
    this._listeners = {};
  }
  addEventListener(evt, fn) { if (!this._listeners[evt]) this._listeners[evt] = []; this._listeners[evt].push(fn); }
  removeEventListener() {}
  querySelector() { return new MockElement('child'); }
  querySelectorAll() { return []; }
  appendChild(c) { this.children.push(c); }
  setAttribute() {}
  getAttribute() { return ''; }
  removeAttribute() {}
  scrollIntoView() {}
}

const elements = new Map();
function getEl(id) {
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
}

const idRegex = /id="([^"]+)"/g;
let m;
while ((m = idRegex.exec(html)) !== null) getEl(m[1]);

const context = {
  console: console,
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: (id) => getEl(id),
    querySelector: (sel) => sel.startsWith('#') ? getEl(sel.slice(1)) : new MockElement('sel'),
    querySelectorAll: () => [],
    createElement: (tag) => new MockElement('el-' + tag, tag),
    body: new MockElement('body'),
    addEventListener: () => {}
  },
  window: { addEventListener: () => {} }
};
context.window.document = context.document;
vm.createContext(context);

const scripts = ['lexer.js', 'parser.js', 'semantic.js', 'icg.js', 'optimizer.js', 'codegen.js', 'vm.js', 'ui.js'];
for (const s of scripts) {
  vm.runInContext(fs.readFileSync('./' + s, 'utf8'), context);
}

const code = `def square(n)
  return n * n
end

puts square(4)`;

context.testCode = code;
vm.runInContext(`
AppState.sourceCode = testCode;
compileAndRunAll();

console.log('BROWSER SIMULATION RESULT:');
console.log('1. Lexer badge:     ', document.getElementById('badge-lexer').textContent);
console.log('2. Parser badge:    ', document.getElementById('badge-parser').textContent);
console.log('3. Semantic badge:  ', document.getElementById('badge-semantic').textContent);
console.log('4. ICG badge:       ', document.getElementById('badge-icg').textContent);
console.log('5. Optimizer badge: ', document.getElementById('badge-optimizer').textContent);
console.log('6. Codegen badge:   ', document.getElementById('badge-codegen').textContent);
console.log('7. Targetopt badge: ', document.getElementById('badge-targetopt').textContent);
console.log('8. Execution badge: ', document.getElementById('badge-execution').textContent);
console.log('Active Tab:         ', AppState.currentTab);
console.log('VM Output:          ', AppState.results.vm ? AppState.results.vm.output : 'NONE');
console.log('AST Output:         ', AppState.results.astInterpreter ? AppState.results.astInterpreter.output : 'NONE');
console.log('Verified:           ', AppState.results.astInterpreter ? AppState.results.astInterpreter.verified : false);
`, context);
