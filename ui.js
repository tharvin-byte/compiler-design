/**
 * CompilerLens - UI Orchestrator & Viewport Controller (ui.js)
 * Coordinates the 7-phase compiler pipeline, manages code editor syntax coloring,
 * renders interactive SVG AST and CFG diagrams, animates VM step execution,
 * handles quick-fixes, report exports, and local storage persistence.
 */

// Global App State
const AppState = {
  sourceCode: '',
  theme: 'dark',
  currentTab: 'lexer',
  compiling: false,
  autoPlaying: false,
  autoPlayTimer: null,
  currentPhaseIndex: 0,
  
  // Compiler Phase Results
  results: {
    lexer: null,
    parser: null,
    semantic: null,
    icg: null,
    optimizer: null,
    codegen: null,
    targetopt: null,
    vm: null,
    astInterpreter: null
  },

  // Timing per phase
  timings: {
    lexer: 0,
    parser: 0,
    semantic: 0,
    icg: 0,
    optimizer: 0,
    codegen: 0,
    targetopt: 0,
    execution: 0
  },

  // AST SVG Navigation
  astPan: { x: 0, y: 0, scale: 1, isDragging: false, startX: 0, startY: 0 },
  hoveredAstNode: null
};

// Built-in Examples
const EXAMPLES = {
  default: `int square(int n) {
    return n * n;
}

int main() {
    int b = 5;
    int c = 10;
    int a = b + c * 2;
    print(a);
    for (int i = 1; i <= 3; i++) {
        print(square(i));
    }
    return 0;
}`,

  factorial: `int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int res = factorial(5);
    print(res);
    return 0;
}`,

  fibonacci: `int fib(int n) {
    if (n <= 0) return 0;
    if (n == 1) return 1;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    for (int i = 0; i < 7; i++) {
        print(fib(i));
    }
    return 0;
}`,

  bubblesort: `int main() {
    int arr[5] = {50, 20, 40, 10, 30};
    for (int i = 0; i < 5; i++) {
        for (int j = 0; j < 4; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
    for (int k = 0; k < 5; k++) {
        print(arr[k]);
    }
    return 0;
}`,

  primechecker: `int isPrime(int n) {
    if (n <= 1) return 0;
    for (int i = 2; i * i <= n; i++) {
        if (n % i == 0) return 0;
    }
    return 1;
}

int main() {
    for (int num = 2; num <= 15; num++) {
        if (isPrime(num) == 1) {
            print(num);
        }
    }
    return 0;
}`,

  optimization: `int main() {
    // Constant folding & propagation demo
    int a = 10 + 20 * 3;
    int b = a + 0;
    int c = b * 1;
    int d = c - c;
    int dead = 999;
    print(c);
    return 0;
}`,

  semantic_error: `int main() {
    // b and c are undeclared - triggers semantic error & quick fix
    int a = b + c;
    print(a);
    return 0;
}`,

  syntax_error: `int main() {
    // Missing semicolon on line 3 - triggers syntax recovery
    int a = 5
    int b = 10;
    print(a + b);
    return 0;
}`,

  runtime_divzero: `int main() {
    int x = 42;
    int zero = 0;
    int y = x / zero;
    print(y);
    return 0;
}`,

  infinite_loop: `int main() {
    int count = 0;
    while (1) {
        count++;
    }
    return 0;
}`
};

// Initializer
document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  loadSavedState();
  initEditor();
  initPipelineControls();
  initVMControls();
  initASTViewer();
  compileAndRunAll(); // Initial run on load
});

// -------------------------------------------------------------
// DOM Initialization & Event Wiring
// -------------------------------------------------------------

function initDOM() {
  // Theme Toggle
  const themeBtn = document.getElementById('themeToggleBtn');
  themeBtn.addEventListener('click', toggleTheme);

  // Example Selector
  const exampleSelect = document.getElementById('exampleSelect');
  exampleSelect.addEventListener('change', (e) => {
    loadExample(e.target.value);
  });

  // Tab Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Stepper Node Clicks
  const stepNodes = document.querySelectorAll('.step-node');
  stepNodes.forEach(node => {
    node.addEventListener('click', () => {
      switchTab(node.dataset.phase);
    });
  });

  // Export Report Button
  document.getElementById('exportReportBtn').addEventListener('click', exportReport);

  // Copy Phase Button
  document.getElementById('copyPhaseBtn').addEventListener('click', copyActivePhaseOutput);

  // Token Filter Tags
  const filterTags = document.querySelectorAll('.tag-chip');
  filterTags.forEach(tag => {
    tag.addEventListener('click', () => {
      filterTags.forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      filterTokenTable(tag.dataset.type, document.getElementById('tokenSearchInput').value);
    });
  });

  // Token Search Input
  document.getElementById('tokenSearchInput').addEventListener('input', (e) => {
    const activeType = document.querySelector('.tag-chip.active')?.dataset.type || 'ALL';
    filterTokenTable(activeType, e.target.value);
  });

  // AST View Toggles (SVG vs Text)
  document.getElementById('astViewSvgBtn').addEventListener('click', () => toggleASTView('svg'));
  document.getElementById('astViewTextBtn').addEventListener('click', () => toggleASTView('text'));

  // ICG View Toggles (Both, TAC, CFG)
  document.getElementById('icgViewBothBtn').addEventListener('click', () => toggleICGView('both'));
  document.getElementById('icgViewTacBtn').addEventListener('click', () => toggleICGView('tac'));
  document.getElementById('icgViewCfgBtn').addEventListener('click', () => toggleICGView('cfg'));

  // File Upload & Download
  const fileInput = document.getElementById('fileUploadInput');
  fileInput.addEventListener('change', handleFileUpload);
  document.getElementById('downloadSourceBtn').addEventListener('click', downloadSourceCode);
  document.getElementById('clearEditorBtn').addEventListener('click', clearEditor);

  // Toast Close
  document.getElementById('toastCloseBtn').addEventListener('click', hideToast);

  // Quick Fix
  document.getElementById('applyQuickFixBtn').addEventListener('click', applyCurrentQuickFix);

  // Keyboard shortcut Ctrl+Enter to compile
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      compileAndRunAll();
    }
  });
}

function loadSavedState() {
  const savedCode = localStorage.getItem('compilerlens_code');
  const savedTheme = localStorage.getItem('compilerlens_theme');
  
  if (savedTheme) {
    AppState.theme = savedTheme;
    document.body.className = `theme-${savedTheme}`;
    document.querySelector('.theme-icon').textContent = savedTheme === 'dark' ? '🌙' : '☀️';
  }

  const editor = document.getElementById('codeEditor');
  if (savedCode) {
    editor.value = savedCode;
    AppState.sourceCode = savedCode;
  } else {
    editor.value = EXAMPLES.default;
    AppState.sourceCode = EXAMPLES.default;
  }
}

function saveState() {
  localStorage.setItem('compilerlens_code', AppState.sourceCode);
  localStorage.setItem('compilerlens_theme', AppState.theme);
}

function toggleTheme() {
  AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
  document.body.className = `theme-${AppState.theme}`;
  document.querySelector('.theme-icon').textContent = AppState.theme === 'dark' ? '🌙' : '☀️';
  saveState();
}

function loadExample(key) {
  if (EXAMPLES[key]) {
    const editor = document.getElementById('codeEditor');
    editor.value = EXAMPLES[key];
    AppState.sourceCode = EXAMPLES[key];
    updateEditorHighlight();
    saveState();
    compileAndRunAll();
  }
}

function switchTab(tabKey) {
  AppState.currentTab = tabKey;
  
  // Update Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });

  // Update Step nodes active highlight
  document.querySelectorAll('.step-node').forEach(node => {
    node.classList.toggle('active', node.dataset.phase === tabKey);
  });

  // Update tab content panes
  document.querySelectorAll('.tab-content').forEach(pane => {
    pane.classList.remove('active');
  });

  const activePane = document.getElementById(`tabContent-${tabKey}`);
  if (activePane) {
    activePane.classList.add('active');
  }

  // Refresh dynamic diagrams if needed
  if (tabKey === 'parser' && AppState.results.parser?.ast) {
    renderASTSvg(AppState.results.parser.ast);
  } else if (tabKey === 'icg' && AppState.results.icg?.functions) {
    renderCFGSvg(AppState.results.icg.functions);
  }
}

// -------------------------------------------------------------
// Code Editor Mechanics (Syntax Highlight, Line Numbers, Error Squiggles)
// -------------------------------------------------------------

function initEditor() {
  const textarea = document.getElementById('codeEditor');
  const gutter = document.getElementById('editorGutter');

  textarea.addEventListener('input', () => {
    AppState.sourceCode = textarea.value;
    updateEditorHighlight();
    saveState();
  });

  textarea.addEventListener('scroll', () => {
    gutter.scrollTop = textarea.scrollTop;
    document.getElementById('editorHighlightLayer').scrollTop = textarea.scrollTop;
    document.getElementById('editorHighlightLayer').scrollLeft = textarea.scrollLeft;
  });

  // Tab key & auto-indent handling
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;
      AppState.sourceCode = textarea.value;
      updateEditorHighlight();
    } else if (e.key === 'Enter') {
      // Auto-indent
      const start = textarea.selectionStart;
      const lineBefore = textarea.value.substring(0, start).split('\n').pop();
      const indentMatch = lineBefore.match(/^\s*/);
      let indent = indentMatch ? indentMatch[0] : '';
      if (lineBefore.trim().endsWith('{')) {
        indent += '    ';
      }
      setTimeout(() => {
        const curPos = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, curPos) + indent + textarea.value.substring(curPos);
        textarea.selectionStart = textarea.selectionEnd = curPos + indent.length;
        AppState.sourceCode = textarea.value;
        updateEditorHighlight();
      }, 0);
    }
  });

  updateEditorHighlight();
}

function updateEditorHighlight(errors = []) {
  const textarea = document.getElementById('codeEditor');
  const highlightLayer = document.getElementById('editorHighlightLayer');
  const gutter = document.getElementById('editorGutter');
  const code = textarea.value;

  // Update Gutter line numbers
  const lines = code.split('\n');
  const lineCount = lines.length;
  const errorLines = new Set(errors.map(err => err.line));

  let gutterHtml = '';
  for (let i = 1; i <= lineCount; i++) {
    const hasErr = errorLines.has(i) ? ' has-error' : '';
    gutterHtml += `<div class="gutter-number${hasErr}">${i}</div>`;
  }
  gutter.innerHTML = gutterHtml;

  // Simple token regex highlighter for real-time editor typing
  const escaped = escapeHtml(code);
  const highlighted = escaped
    .replace(/\/\*[\s\S]*?\*\//g, m => `<span class="hl-comment">${m}</span>`)
    .replace(/\/\/[^\n]*/g, m => `<span class="hl-comment">${m}</span>`)
    .replace(/"(\\.|[^"\\])*"/g, m => `<span class="hl-string">${m}</span>`)
    .replace(/'(\\.|[^'\\])*'/g, m => `<span class="hl-string">${m}</span>`)
    .replace(/\b(int|float|char|bool|void)\b/g, m => `<span class="hl-type">${m}</span>`)
    .replace(/\b(if|else|while|for|do|break|continue|return|print|printf|scanf|input|true|false)\b/g, m => `<span class="hl-keyword">${m}</span>`)
    .replace(/\b(\d+(\.\d+)?)\b/g, m => `<span class="hl-number">${m}</span>`)
    .replace(/([+\-*\/%=<>!&|]+)/g, m => `<span class="hl-operator">${m}</span>`);

  highlightLayer.innerHTML = highlighted + '\n';
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clearEditor() {
  const textarea = document.getElementById('codeEditor');
  textarea.value = '';
  AppState.sourceCode = '';
  updateEditorHighlight();
  saveState();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target.result;
    document.getElementById('codeEditor').value = content;
    AppState.sourceCode = content;
    updateEditorHighlight();
    saveState();
    compileAndRunAll();
  };
  reader.readAsText(file);
}

function downloadSourceCode() {
  const blob = new Blob([AppState.sourceCode], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'program.c';
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// Pipeline Compilation Controller
// -------------------------------------------------------------

function initPipelineControls() {
  document.getElementById('compileRunBtn').addEventListener('click', compileAndRunAll);
  document.getElementById('stepPhaseBtn').addEventListener('click', stepPipelinePhase);
  document.getElementById('autoPlayBtn').addEventListener('click', togglePipelineAutoPlay);
  document.getElementById('resetPipelineBtn').addEventListener('click', resetPipeline);
}

function compileAndRunAll() {
  hideToast();
  hideQuickFix();
  resetStepIndicators();
  triggerPulseAnimation();

  const code = AppState.sourceCode;
  let allErrors = [];

  // Phase 1: Lexical Analysis
  const t0 = performance.now();
  const lexer = new Lexer(code);
  const lexerRes = lexer.tokenize();
  AppState.timings.lexer = Math.round((performance.now() - t0) * 100) / 100;
  AppState.results.lexer = lexerRes;
  renderLexerOutput(lexerRes);

  if (lexerRes.errors.length > 0) {
    allErrors.push(...lexerRes.errors);
    markStepFailed('lexer');
    markStepsSkipped(['parser', 'semantic', 'icg', 'optimizer', 'codegen', 'targetopt', 'execution']);
    showToast(lexerRes.errors[0].message);
    updateEditorHighlight(allErrors);
    switchTab('lexer');
    return;
  }
  markStepCompleted('lexer', `${lexerRes.stats.totalTokens} tok`);

  // Phase 2: Syntax Analysis
  const t1 = performance.now();
  const parser = new Parser(lexerRes.tokens);
  const parserRes = parser.parse();
  AppState.timings.parser = Math.round((performance.now() - t1) * 100) / 100;
  AppState.results.parser = parserRes;
  renderParserOutput(parserRes);

  if (parserRes.errors.length > 0) {
    allErrors.push(...parserRes.errors);
    markStepFailed('parser');
    markStepsSkipped(['semantic', 'icg', 'optimizer', 'codegen', 'targetopt', 'execution']);
    showToast(parserRes.errors[0].message);
    updateEditorHighlight(allErrors);
    switchTab('parser');
    return;
  }
  markStepCompleted('parser', `AST ready`);

  // Phase 3: Semantic Analysis
  const t2 = performance.now();
  const semantic = new SemanticAnalyzer();
  const semanticRes = semantic.analyze(parserRes.ast, code);
  AppState.timings.semantic = Math.round((performance.now() - t2) * 100) / 100;
  AppState.results.semantic = semanticRes;
  renderSemanticOutput(semanticRes);

  if (semanticRes.errors.length > 0) {
    allErrors.push(...semanticRes.errors);
    markStepFailed('semantic');
    markStepsSkipped(['icg', 'optimizer', 'codegen', 'targetopt', 'execution']);
    showToast(semanticRes.errors[0].message);
    updateEditorHighlight(allErrors);
    if (semanticRes.quickFixes.length > 0) {
      showQuickFix(semanticRes.quickFixes[0]);
    }
    switchTab('semantic');
    return;
  }
  markStepCompleted('semantic', `${semanticRes.symbolTables.length} syms`);

  // Phase 4: Intermediate Code Generation
  const t3 = performance.now();
  const icg = new ICGGenerator();
  const icgRes = icg.generate(parserRes.ast);
  AppState.timings.icg = Math.round((performance.now() - t3) * 100) / 100;
  AppState.results.icg = icgRes;
  renderICGOutput(icgRes);
  markStepCompleted('icg', `${icgRes.instructions.length} tac`);

  // Phase 5: Code Optimization
  const t4 = performance.now();
  const optimizer = new TACOptimizer();
  const optRes = optimizer.optimize(icgRes);
  AppState.timings.optimizer = Math.round((performance.now() - t4) * 100) / 100;
  AppState.results.optimizer = optRes;
  renderOptimizerOutput(optRes);
  markStepCompleted('optimizer', `${optRes.stats.savedCount} saved`);

  // Phase 6: Code Generation
  const t5 = performance.now();
  const codegen = new CodeGenerator();
  const cgRes = codegen.generate(optRes.functions);
  AppState.timings.codegen = Math.round((performance.now() - t5) * 100) / 100;
  AppState.results.codegen = cgRes;
  renderCodegenOutput(cgRes);
  markStepCompleted('codegen', `${cgRes.rawAssembly.length} asm`);

  // Phase 7: Target Code Optimization (Peephole)
  const t6 = performance.now();
  AppState.timings.targetopt = Math.round((performance.now() - t6) * 100) / 100;
  AppState.results.targetopt = cgRes;
  renderTargetOptOutput(cgRes);
  markStepCompleted('targetopt', `${cgRes.savedCount} saved`);

  // Phase 8 / Execution: Target VM and Dual-Run AST Verification
  loadProgramIntoVM(cgRes.optimizedAssembly, parserRes.ast);
  markStepCompleted('execution', `Ready`);

  // Update Summary Metrics Card
  renderSummaryMetrics();
  updateEditorHighlight(); // Clear errors

  // Switch to execution tab to see real program output!
  switchTab('execution');
}

function resetPipeline() {
  resetStepIndicators();
  hideToast();
  hideQuickFix();
  if (vmInstance) {
    vmInstance.reset();
  }
  updateVMInspector(null);
  switchTab('lexer');
}

function resetStepIndicators() {
  const steps = ['lexer', 'parser', 'semantic', 'icg', 'optimizer', 'codegen', 'targetopt', 'execution'];
  steps.forEach(s => {
    const node = document.getElementById(`step-${s}`);
    if (node) {
      node.className = `step-node ${s === 'execution' ? 'special-node' : ''}`;
    }
  });
}

function markStepCompleted(phase, badgeText = '✓') {
  const node = document.getElementById(`step-${phase}`);
  if (node) {
    node.classList.add('completed');
    node.classList.remove('failed', 'skipped');
    const badge = document.getElementById(`badge-${phase}`);
    if (badge) badge.textContent = badgeText;
  }
}

function markStepFailed(phase) {
  const node = document.getElementById(`step-${phase}`);
  if (node) {
    node.classList.add('failed');
    node.classList.remove('completed', 'skipped');
    const badge = document.getElementById(`badge-${phase}`);
    if (badge) badge.textContent = 'Err';
  }
}

function markStepsSkipped(phases) {
  phases.forEach(phase => {
    const node = document.getElementById(`step-${phase}`);
    if (node) {
      node.classList.add('skipped');
      node.classList.remove('completed', 'failed');
      const badge = document.getElementById(`badge-${phase}`);
      if (badge) badge.textContent = 'skip';
    }
  });
}

function triggerPulseAnimation() {
  const pulse = document.getElementById('pipelinePulse');
  pulse.classList.remove('traveling');
  void pulse.offsetWidth; // trigger reflow
  pulse.classList.add('traveling');
}

function stepPipelinePhase() {
  const phases = ['lexer', 'parser', 'semantic', 'icg', 'optimizer', 'codegen', 'targetopt', 'execution'];
  let curIdx = phases.indexOf(AppState.currentTab);
  let nextIdx = (curIdx + 1) % phases.length;
  switchTab(phases[nextIdx]);
}

function togglePipelineAutoPlay() {
  AppState.autoPlaying = !AppState.autoPlaying;
  const btn = document.getElementById('autoPlayBtn');
  const icon = document.getElementById('autoPlayIcon');
  const text = document.getElementById('autoPlayText');

  if (AppState.autoPlaying) {
    icon.textContent = '⏸';
    text.textContent = 'Pause';
    btn.classList.add('btn-neon');

    const phases = ['lexer', 'parser', 'semantic', 'icg', 'optimizer', 'codegen', 'targetopt', 'execution'];
    let idx = 0;

    AppState.autoPlayTimer = setInterval(() => {
      if (idx >= phases.length) {
        clearInterval(AppState.autoPlayTimer);
        AppState.autoPlaying = false;
        icon.textContent = '▶';
        text.textContent = 'Auto-Play';
        btn.classList.remove('btn-neon');
        return;
      }
      switchTab(phases[idx]);
      idx++;
    }, 1200);
  } else {
    clearInterval(AppState.autoPlayTimer);
    icon.textContent = '▶';
    text.textContent = 'Auto-Play';
    btn.classList.remove('btn-neon');
  }
}

// -------------------------------------------------------------
// Renderers for 7 Phases
// -------------------------------------------------------------

// Phase 1: Lexer Renderer
function renderLexerOutput(res) {
  const tableBody = document.getElementById('tokenTableBody');
  const metricsChips = document.getElementById('lexerMetricsChips');

  metricsChips.innerHTML = `
    <span class="chip chip-keyword">${res.stats.totalTokens} Tokens</span>
    <span class="chip chip-operator">${res.stats.linesOfCode} Lines</span>
    <span class="chip chip-string">${res.stats.commentCount} Comments</span>
  `;

  let html = '';
  res.tokens.forEach((t, i) => {
    if (t.type === 'EOF') return;
    const chipClass = `chip-${t.type.toLowerCase()}`;
    html += `
      <tr>
        <td>${i + 1}</td>
        <td><code>${escapeHtml(String(t.raw || t.value))}</code></td>
        <td><span class="chip ${chipClass}">${t.type}</span></td>
        <td>${t.line} : ${t.col}</td>
        <td>${t.length}</td>
      </tr>
    `;
  });

  tableBody.innerHTML = html || '<tr><td colspan="5" class="empty-state">No tokens found.</td></tr>';
}

function filterTokenTable(type, query) {
  const rows = document.querySelectorAll('#tokenTableBody tr');
  const q = (query || '').toLowerCase().trim();

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) return;
    const lexeme = cells[1].textContent.toLowerCase();
    const tokenType = cells[2].textContent.trim();
    const matchType = (type === 'ALL' || tokenType === type);
    const matchQuery = !q || lexeme.includes(q) || tokenType.toLowerCase().includes(q) || cells[3].textContent.includes(q);

    row.style.display = (matchType && matchQuery) ? '' : 'none';
  });
}

// Phase 2: Parser & AST Renderer
function renderParserOutput(res) {
  // Render compact text tree
  const textContainer = document.getElementById('astTextContent');
  textContainer.textContent = Parser.toTextTree(res.ast);

  // Render SVG interactive tree
  renderASTSvg(res.ast);
}

function toggleASTView(view) {
  const svgWrapper = document.getElementById('astSvgWrapper');
  const textWrapper = document.getElementById('astTextWrapper');
  const svgBtn = document.getElementById('astViewSvgBtn');
  const textBtn = document.getElementById('astViewTextBtn');

  if (view === 'svg') {
    svgWrapper.classList.remove('hidden');
    textWrapper.classList.add('hidden');
    svgBtn.classList.add('active');
    textBtn.classList.remove('active');
  } else {
    svgWrapper.classList.add('hidden');
    textWrapper.classList.remove('hidden');
    svgBtn.classList.remove('active');
    textBtn.classList.add('active');
  }
}

function initASTViewer() {
  const svg = document.getElementById('astSvg');
  const rootG = document.getElementById('astSvgRoot');

  svg.addEventListener('mousedown', (e) => {
    AppState.astPan.isDragging = true;
    AppState.astPan.startX = e.clientX - AppState.astPan.x;
    AppState.astPan.startY = e.clientY - AppState.astPan.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!AppState.astPan.isDragging) return;
    AppState.astPan.x = e.clientX - AppState.astPan.startX;
    AppState.astPan.y = e.clientY - AppState.astPan.startY;
    applyASTTransform();
  });

  window.addEventListener('mouseup', () => {
    AppState.astPan.isDragging = false;
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 0.88;
    AppState.astPan.scale = Math.min(3, Math.max(0.2, AppState.astPan.scale * delta));
    applyASTTransform();
  });

  document.getElementById('zoomInAstBtn').addEventListener('click', () => {
    AppState.astPan.scale = Math.min(3, AppState.astPan.scale * 1.25);
    applyASTTransform();
  });

  document.getElementById('zoomOutAstBtn').addEventListener('click', () => {
    AppState.astPan.scale = Math.max(0.2, AppState.astPan.scale * 0.8);
    applyASTTransform();
  });

  document.getElementById('resetZoomAstBtn').addEventListener('click', () => {
    AppState.astPan.x = 0;
    AppState.astPan.y = 0;
    AppState.astPan.scale = 1;
    applyASTTransform();
  });
}

function applyASTTransform() {
  const rootG = document.getElementById('astSvgRoot');
  rootG.setAttribute('transform', `translate(${AppState.astPan.x}, ${AppState.astPan.y}) scale(${AppState.astPan.scale})`);
}

function renderASTSvg(ast) {
  if (!ast) return;
  const rootG = document.getElementById('astSvgRoot');
  rootG.innerHTML = '';

  const bounds = Parser.computeLayout(ast);

  // SVG paths and node groups
  let linksSvg = '';
  let nodesSvg = '';

  function traverse(node) {
    if (!node) return;
    const children = node.collapsed ? [] : (node.getChildren ? node.getChildren() : (node.children || []));

    for (const child of children) {
      // Curved cubic Bézier path
      const startX = node.x;
      const startY = node.y + 20;
      const endX = child.x;
      const endY = child.y - 20;
      const midY = (startY + endY) / 2;

      linksSvg += `<path class="ast-link" d="M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}" />`;
      traverse(child);
    }

    const title = node.type.replace('Statement', '').replace('Declaration', '').replace('Expression', '');
    const subtitle = node.name || (node.value !== undefined ? String(node.value) : (node.operator || ''));

    nodesSvg += `
      <g class="ast-node-group" data-nodeid="${node.nodeId}" transform="translate(${node.x - 60}, ${node.y - 20})">
        <rect class="ast-node-rect" width="120" height="40" />
        <text class="ast-node-text-title" x="60" y="16">${title}</text>
        <text class="ast-node-text-sub" x="60" y="30">${escapeHtml(subtitle.substring(0, 16))}</text>
        ${(node.getChildren && node.getChildren().length > 0) ? `
          <circle class="ast-collapse-badge" cx="60" cy="40" r="5" />
        ` : ''}
      </g>
    `;
  }

  traverse(ast);
  rootG.innerHTML = linksSvg + nodesSvg;

  // Add click to collapse & hover to highlight editor
  rootG.querySelectorAll('.ast-node-group').forEach(group => {
    const nodeId = parseInt(group.dataset.nodeid, 10);
    const targetNode = findASTNodeById(ast, nodeId);

    group.addEventListener('click', (e) => {
      e.stopPropagation();
      if (targetNode) {
        targetNode.collapsed = !targetNode.collapsed;
        renderASTSvg(ast);
      }
    });

    group.addEventListener('mouseenter', () => {
      if (targetNode && targetNode.line) {
        highlightSourceLine(targetNode.line);
      }
    });

    group.addEventListener('mouseleave', () => {
      clearSourceHighlight();
    });
  });

  applyASTTransform();
}

function findASTNodeById(root, id) {
  if (!root) return null;
  if (root.nodeId === id) return root;
  const children = root.getChildren ? root.getChildren() : (root.children || []);
  for (const c of children) {
    const res = findASTNodeById(c, id);
    if (res) return res;
  }
  return null;
}

function highlightSourceLine(lineNum) {
  const gutterNums = document.querySelectorAll('.gutter-number');
  gutterNums.forEach((g, idx) => {
    if (idx + 1 === lineNum) {
      g.style.color = '#00f2fe';
      g.style.fontWeight = 'bold';
    }
  });
}

function clearSourceHighlight() {
  const gutterNums = document.querySelectorAll('.gutter-number');
  gutterNums.forEach(g => {
    if (!g.classList.contains('has-error')) {
      g.style.color = '';
      g.style.fontWeight = '';
    }
  });
}

// Phase 3: Semantic Renderer
function renderSemanticOutput(res) {
  const tableBody = document.getElementById('symbolTableBody');
  const diagContainer = document.getElementById('semanticDiagnosticsList');

  // Symbol table
  let tableHtml = '';
  res.symbolTables.forEach(sym => {
    tableHtml += `
      <tr>
        <td><strong>${sym.name}</strong></td>
        <td><code>${sym.type}</code></td>
        <td><span class="chip chip-${sym.kind}">${sym.kind}</span></td>
        <td>Level ${sym.scopeLevel}</td>
        <td>${sym.scopeName}</td>
        <td>${sym.line || 'global'}</td>
      </tr>
    `;
  });
  tableBody.innerHTML = tableHtml || '<tr><td colspan="6" class="empty-state">No symbols recorded.</td></tr>';

  // Diagnostics list (passes, warnings, errors)
  let diagHtml = '';

  for (const pass of res.passedChecks) {
    diagHtml += `
      <div class="diag-item diag-pass">
        <span class="diag-icon">✅</span>
        <div class="diag-content">
          <div class="diag-title">${pass.name}</div>
          <div class="diag-desc">${pass.message}</div>
        </div>
      </div>
    `;
  }

  for (const warn of res.warnings) {
    diagHtml += `
      <div class="diag-item diag-warn">
        <span class="diag-icon">⚠️</span>
        <div class="diag-content">
          <div class="diag-title">Warning (L${warn.line}:${warn.col})</div>
          <div class="diag-desc">${warn.message}</div>
          ${warn.suggestion ? `<div class="diag-suggestion">💡 ${warn.suggestion}</div>` : ''}
        </div>
      </div>
    `;
  }

  for (const err of res.errors) {
    diagHtml += `
      <div class="diag-item diag-error">
        <span class="diag-icon">❌</span>
        <div class="diag-content">
          <div class="diag-title">Semantic Error (L${err.line}:${err.col})</div>
          <div class="diag-desc">${err.message}</div>
          ${err.suggestion ? `<div class="diag-suggestion">💡 ${err.suggestion}</div>` : ''}
        </div>
      </div>
    `;
  }

  diagContainer.innerHTML = diagHtml || '<div class="empty-state">No diagnostics available.</div>';
}

// Phase 4: Intermediate Code Generation (TAC & CFG)
function renderICGOutput(res) {
  // Linear TAC
  const tacContainer = document.getElementById('tacCodeContent');
  let tacText = '';
  res.functions.forEach(f => {
    tacText += `// --- Subroutine: ${f.name} (${f.returnType}) ---\n`;
    f.instructions.forEach(i => {
      tacText += `  ${i.toString()}\n`;
    });
    tacText += '\n';
  });
  tacContainer.textContent = tacText;

  // CFG Diagram
  renderCFGSvg(res.functions);
}

function toggleICGView(view) {
  const tacCol = document.getElementById('icgTacColumn');
  const cfgCol = document.getElementById('icgCfgColumn');
  const bothBtn = document.getElementById('icgViewBothBtn');
  const tacBtn = document.getElementById('icgViewTacBtn');
  const cfgBtn = document.getElementById('icgViewCfgBtn');

  [bothBtn, tacBtn, cfgBtn].forEach(b => b.classList.remove('active'));

  if (view === 'both') {
    tacCol.style.display = 'flex';
    cfgCol.style.display = 'flex';
    bothBtn.classList.add('active');
  } else if (view === 'tac') {
    tacCol.style.display = 'flex';
    cfgCol.style.display = 'none';
    tacBtn.classList.add('active');
  } else {
    tacCol.style.display = 'none';
    cfgCol.style.display = 'flex';
    cfgBtn.classList.add('active');
  }
}

function renderCFGSvg(functions) {
  const rootG = document.getElementById('cfgSvgRoot');
  if (!rootG) return;
  rootG.innerHTML = '';

  let blocksSvg = '';
  let edgesSvg = '';

  functions.forEach((f, fIdx) => {
    const blocks = f.blocks || [];
    blocks.forEach((b, idx) => {
      // Basic block rect
      const headerH = 26;
      blocksSvg += `
        <g class="cfg-block-group" transform="translate(${b.x}, ${b.y})">
          <rect class="cfg-block-rect" width="${b.width}" height="${b.height}" />
          <rect class="cfg-block-header" width="${b.width}" height="${headerH}" />
          <text class="cfg-block-title" x="12" y="17">${b.id} ${b.label ? `[${b.label}]` : ''} - ${f.name}</text>
      `;

      b.instructions.forEach((inst, iIdx) => {
        blocksSvg += `<text class="cfg-inst-text" x="12" y="${headerH + 18 + iIdx * 20}">${escapeHtml(inst.toString())}</text>`;
      });

      blocksSvg += `</g>`;

      // Successor edges
      b.successors.forEach(succ => {
        const targetBlock = blocks.find(blk => blk.id === succ.targetId);
        if (targetBlock) {
          const startX = b.x + b.width / 2;
          const startY = b.y + b.height;
          const endX = targetBlock.x + targetBlock.width / 2;
          const endY = targetBlock.y;

          let edgeClass = 'unconditional';
          let markerId = 'arrow-uncond';
          if (succ.type === 'true') {
            edgeClass = 'true-branch';
            markerId = 'arrow-true';
          } else if (succ.type === 'false') {
            edgeClass = 'false-branch';
            markerId = 'arrow-false';
          }

          // Curved path
          const midY = (startY + endY) / 2;
          edgesSvg += `<path class="cfg-edge ${edgeClass}" d="M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}" marker-end="url(#${markerId})" />`;
        }
      });
    });
  });

  rootG.innerHTML = edgesSvg + blocksSvg;
}

// Phase 5: Optimizer Renderer
function renderOptimizerOutput(res) {
  document.getElementById('optimizerStatsChip').textContent = `${res.stats.savedCount} instructions eliminated (${res.stats.originalCount} → ${res.stats.optimizedCount})`;

  const beforeBody = document.getElementById('diffBeforeBody');
  const afterBody = document.getElementById('diffAfterBody');
  const ledgerList = document.getElementById('optimizationLedgerList');

  let beforeHtml = '';
  let afterHtml = '';

  res.diff.forEach(d => {
    const statusClass = d.status === 'unchanged' ? '' : d.status;
    beforeHtml += `<div class="diff-line ${statusClass}"><span class="diff-num">${d.line}</span><span>${escapeHtml(d.before)}</span></div>`;
    afterHtml += `<div class="diff-line ${statusClass}"><span class="diff-num">${d.line}</span><span>${escapeHtml(d.after)}</span></div>`;
  });

  beforeBody.innerHTML = beforeHtml;
  afterBody.innerHTML = afterHtml;

  // Ledger list
  let ledgerHtml = '';
  res.ledger.forEach(entry => {
    ledgerHtml += `
      <div class="ledger-item">
        <div>
          <span class="ledger-rule">${entry.rule}</span>
          <span class="ledger-desc"> — ${entry.description}</span>
        </div>
        <div><code>${escapeHtml(entry.before)} → ${escapeHtml(entry.after)}</code></div>
      </div>
    `;
  });

  ledgerList.innerHTML = ledgerHtml || '<div class="empty-state">Code is already optimal.</div>';
}

// Phase 6: Codegen Renderer
function renderCodegenOutput(res) {
  document.getElementById('asmStatsBadge').textContent = `${res.rawAssembly.length} instructions`;
  document.getElementById('rawAssemblyContent').textContent = res.rawAssembly.map(i => i.toString()).join('\n');
}

// Phase 7: Target Peephole Optimizer Renderer
function renderTargetOptOutput(res) {
  document.getElementById('peepholeStatsBadge').textContent = `${res.savedCount} instructions saved (${res.percentage}%)`;

  const beforeBody = document.getElementById('peepholeDiffBefore');
  const afterBody = document.getElementById('peepholeDiffAfter');
  const rulesList = document.getElementById('peepholeRulesList');

  let beforeHtml = '';
  let afterHtml = '';

  res.diff.forEach(d => {
    const statusClass = d.status === 'unchanged' ? '' : d.status;
    beforeHtml += `<div class="diff-line ${statusClass}"><span class="diff-num">${d.line}</span><span>${escapeHtml(d.before)}</span></div>`;
    afterHtml += `<div class="diff-line ${statusClass}"><span class="diff-num">${d.line}</span><span>${escapeHtml(d.after)}</span></div>`;
  });

  beforeBody.innerHTML = beforeHtml;
  afterBody.innerHTML = afterHtml;

  let rulesHtml = '';
  res.rulesApplied.forEach(r => {
    rulesHtml += `
      <div class="ledger-item">
        <span class="ledger-rule">${r.rule}</span>
        <span class="ledger-desc">${r.description}</span>
      </div>
    `;
  });

  rulesList.innerHTML = rulesHtml || '<div class="empty-state">No peephole optimizations fired.</div>';
}

// -------------------------------------------------------------
// VM Visualizer & Execution Controller
// -------------------------------------------------------------

let vmInstance = null;

function initVMControls() {
  document.getElementById('vmRunBtn').addEventListener('click', () => {
    if (vmInstance) {
      const speed = parseInt(document.getElementById('speedSlider').value, 10);
      vmInstance.startAutoPlay(speed);
    }
  });

  document.getElementById('vmStepBtn').addEventListener('click', () => {
    if (vmInstance) {
      vmInstance.step();
    }
  });

  document.getElementById('vmPauseBtn').addEventListener('click', () => {
    if (vmInstance) {
      vmInstance.pause();
    }
  });

  document.getElementById('vmResetBtn').addEventListener('click', () => {
    if (vmInstance) {
      vmInstance.reset();
      updateVMInspector(null);
      clearConsole();
    }
  });

  const speedSlider = document.getElementById('speedSlider');
  const speedText = document.getElementById('speedValueText');
  speedSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    speedText.textContent = `${val}ms`;
    if (vmInstance) {
      vmInstance.speed = parseInt(val, 10);
    }
  });

  document.getElementById('clearConsoleBtn').addEventListener('click', clearConsole);

  document.getElementById('consoleInputSubmitBtn').addEventListener('click', submitConsoleInput);
  document.getElementById('consoleInputField').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitConsoleInput();
    }
  });
}

function loadProgramIntoVM(instructions, ast) {
  clearConsole();

  // Create Virtual Machine instance
  vmInstance = new VirtualMachine({
    onOutput: (val) => {
      appendConsoleOutput(String(val));
    },
    onInputRequired: () => {
      showConsoleInputPrompt();
    },
    onStep: (stepInfo) => {
      updateVMInspector(stepInfo);
    },
    onHalt: (result) => {
      appendConsoleOutput(`[Process completed with exit code ${result.stats.exitCode}]`, 'system-line');
      updateVMInspector(null);
    },
    onError: (err) => {
      appendConsoleOutput(`[Runtime Error] ${err}`, 'diag-error');
      showToast(err);
    }
  });

  vmInstance.load(instructions);

  // Render assembly scroller view
  const scroller = document.getElementById('vmAsmScroller');
  let asmHtml = '';
  instructions.forEach((inst, idx) => {
    asmHtml += `<div class="vm-asm-line" id="asm-line-${idx}"><code>${escapeHtml(inst.toString())}</code></div>`;
  });
  scroller.innerHTML = asmHtml;

  // Run full synchronous execution to populate stats and dual-run verification
  const vmRunResult = vmInstance.runSynchronous();

  // AST Reference Interpreter Dual-Execution Verification
  const astInterpreter = new ASTInterpreter();
  const astResult = astInterpreter.run(ast);
  AppState.results.astInterpreter = astResult;

  const matches = (JSON.stringify(vmRunResult.output) === JSON.stringify(astResult.output)) && astResult.verified;

  const badge = document.getElementById('verificationBadge');
  if (matches) {
    badge.className = 'verification-badge verified';
    badge.innerHTML = '<span class="v-icon">✓</span><span class="v-text">Verified ✓ (Matches AST Interpreter)</span>';
  } else {
    badge.className = 'verification-badge pending';
    badge.innerHTML = '<span class="v-icon">ℹ</span><span class="v-text">Execution Complete</span>';
  }

  // Update metrics chip
  document.getElementById('vmMetricsChip').innerHTML = `
    <span>${vmRunResult.stats.instructionsExecuted} insts</span> • 
    <span>${vmRunResult.stats.executionTimeMs} ms</span> • 
    <span>Exit: ${vmRunResult.stats.exitCode}</span>
  `;

  // Reset VM to beginning so user can also step through visually if desired!
  vmInstance.reset();
  updateVMInspector(null);
}

function updateVMInspector(stepInfo) {
  if (!vmInstance) return;

  const pc = vmInstance.PC;
  const sp = vmInstance.SP;
  const fp = vmInstance.FP;

  // Update PC, SP, FP cards
  document.getElementById('ptr-PC').textContent = pc;
  document.getElementById('ptr-SP').textContent = sp;
  document.getElementById('ptr-FP').textContent = fp;
  document.getElementById('flag-Z').textContent = vmInstance.flags.zero ? 'true' : 'false';
  document.getElementById('flag-S').textContent = vmInstance.flags.sign ? 'true' : 'false';

  // Highlight active PC in assembly scroller
  document.querySelectorAll('.vm-asm-line').forEach((line, idx) => {
    if (idx === pc) {
      line.classList.add('current-pc');
      line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      line.classList.remove('current-pc');
    }
  });

  // Update Registers R0-R7 with flash flare animation
  for (let i = 0; i < 8; i++) {
    const regName = `R${i}`;
    const card = document.getElementById(`reg-${regName}`);
    if (card) {
      const valElem = card.querySelector('.reg-val');
      const curVal = vmInstance.registers[regName];
      if (valElem.textContent !== String(curVal)) {
        valElem.textContent = curVal;
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 300);
      }
    }
  }

  // Active call stack
  const callStackContainer = document.getElementById('vmCallStackList');
  if (vmInstance.callStack.length === 0) {
    callStackContainer.innerHTML = '<div class="call-stack-empty">Main Thread (Global / Main)</div>';
  } else {
    let csHtml = '';
    vmInstance.callStack.forEach(frame => {
      csHtml += `<div class="call-frame"><strong>func_${frame.funcName}()</strong> [FP: ${frame.fp}]</div>`;
    });
    callStackContainer.innerHTML = csHtml;
  }
}

function appendConsoleOutput(text, customClass = '') {
  const consoleBody = document.getElementById('consoleBody');
  const line = document.createElement('div');
  line.className = `console-line ${customClass}`;
  line.textContent = text;
  consoleBody.appendChild(line);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

function clearConsole() {
  const consoleBody = document.getElementById('consoleBody');
  consoleBody.innerHTML = '<div class="console-line system-line">CompilerLens Runtime Console cleared.</div>';
}

function showConsoleInputPrompt() {
  const group = document.getElementById('consoleInputGroup');
  group.classList.remove('hidden');
  const input = document.getElementById('consoleInputField');
  input.focus();
}

function submitConsoleInput() {
  const input = document.getElementById('consoleInputField');
  const val = input.value;
  input.value = '';
  document.getElementById('consoleInputGroup').classList.add('hidden');
  appendConsoleOutput(`> ${val}`);
  if (vmInstance) {
    vmInstance.provideInput(val);
  }
}

// -------------------------------------------------------------
// Summary Card & Bar Chart
// -------------------------------------------------------------

function renderSummaryMetrics() {
  const lexer = AppState.results.lexer;
  const parser = AppState.results.parser;
  const semantic = AppState.results.semantic;
  const icg = AppState.results.icg;
  const opt = AppState.results.optimizer;
  const cg = AppState.results.codegen;
  const vm = AppState.results.vm || vmInstance;

  document.getElementById('metric-tokens').textContent = lexer ? lexer.stats.totalTokens : 0;
  document.getElementById('metric-nodes').textContent = parser ? countASTNodes(parser.ast) : 0;
  document.getElementById('metric-symbols').textContent = semantic ? semantic.symbolTables.length : 0;
  document.getElementById('metric-tac').textContent = icg ? icg.instructions.length : 0;
  document.getElementById('metric-tac-opt').textContent = opt ? opt.stats.optimizedCount : 0;
  document.getElementById('metric-asm').textContent = cg ? cg.rawAssembly.length : 0;
  document.getElementById('metric-saved').textContent = (opt ? opt.stats.savedCount : 0) + (cg ? cg.savedCount : 0);
  document.getElementById('metric-exec').textContent = vm ? vm.stepCount : 0;

  // Render compilation timing bar chart
  const chartContainer = document.getElementById('timeBarChart');
  const times = [
    { label: 'Lexer', ms: AppState.timings.lexer },
    { label: 'Parser', ms: AppState.timings.parser },
    { label: 'Semantic', ms: AppState.timings.semantic },
    { label: 'ICG', ms: AppState.timings.icg },
    { label: 'Opt', ms: AppState.timings.optimizer },
    { label: 'Codegen', ms: AppState.timings.codegen }
  ];

  const maxMs = Math.max(1, ...times.map(t => t.ms));

  let chartHtml = '';
  times.forEach(t => {
    const heightPercent = Math.max(8, (t.ms / maxMs) * 100);
    chartHtml += `
      <div class="chart-bar-col">
        <div class="chart-bar-val">${t.ms}ms</div>
        <div class="chart-bar" style="height: ${heightPercent}%;"></div>
        <div class="chart-bar-lbl">${t.label}</div>
      </div>
    `;
  });

  chartContainer.innerHTML = chartHtml;
}

function countASTNodes(node) {
  if (!node) return 0;
  let count = 1;
  const children = node.getChildren ? node.getChildren() : (node.children || []);
  for (const c of children) {
    count += countASTNodes(c);
  }
  return count;
}

// -------------------------------------------------------------
// Quick Fix & Error Toast Management
// -------------------------------------------------------------

let activeQuickFix = null;

function showQuickFix(fix) {
  activeQuickFix = fix;
  const container = document.getElementById('quickFixContainer');
  const text = document.getElementById('quickFixText');
  text.textContent = `Quick fix: ${fix.title}`;
  container.classList.remove('hidden');
}

function hideQuickFix() {
  activeQuickFix = null;
  document.getElementById('quickFixContainer').classList.add('hidden');
}

function applyCurrentQuickFix() {
  if (!activeQuickFix) return;
  const editor = document.getElementById('codeEditor');
  const code = editor.value;
  const lines = code.split('\n');

  // Insert fix at target line
  const targetLine = Math.min(lines.length, Math.max(1, activeQuickFix.line)) - 1;
  lines.splice(targetLine, 0, '    ' + activeQuickFix.patch.trim());
  editor.value = lines.join('\n');
  AppState.sourceCode = editor.value;

  hideQuickFix();
  updateEditorHighlight();
  saveState();
  compileAndRunAll();
}

function showToast(message) {
  const toast = document.getElementById('errorToast');
  document.getElementById('toastMessage').textContent = message;
  toast.classList.remove('hidden');
}

function hideToast() {
  document.getElementById('errorToast').classList.add('hidden');
}

// -------------------------------------------------------------
// Copy & Export Compilation Report
// -------------------------------------------------------------

function copyActivePhaseOutput() {
  let textToCopy = '';
  const tab = AppState.currentTab;

  if (tab === 'lexer' && AppState.results.lexer) {
    textToCopy = AppState.results.lexer.tokens.map(t => `${t.type.padEnd(12)} ${t.value} (L${t.line}:${t.col})`).join('\n');
  } else if (tab === 'parser' && AppState.results.parser) {
    textToCopy = Parser.toTextTree(AppState.results.parser.ast);
  } else if (tab === 'semantic' && AppState.results.semantic) {
    textToCopy = AppState.results.semantic.symbolTables.map(s => `${s.name}: ${s.type} [${s.kind}] in ${s.scopeName}`).join('\n');
  } else if (tab === 'icg' && AppState.results.icg) {
    textToCopy = AppState.results.icg.instructions.map(i => i.toString()).join('\n');
  } else if (tab === 'optimizer' && AppState.results.optimizer) {
    textToCopy = AppState.results.optimizer.afterTAC.map(i => i.toString()).join('\n');
  } else if (tab === 'codegen' && AppState.results.codegen) {
    textToCopy = AppState.results.codegen.rawAssembly.map(i => i.toString()).join('\n');
  } else if (tab === 'targetopt' && AppState.results.targetopt) {
    textToCopy = AppState.results.targetopt.optimizedAssembly.map(i => i.toString()).join('\n');
  } else if (tab === 'execution' && vmInstance) {
    textToCopy = vmInstance.outputBuffer.join('\n');
  }

  if (textToCopy) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Phase output copied to clipboard! ✓');
      setTimeout(hideToast, 2000);
    });
  }
}

function exportReport() {
  const code = AppState.sourceCode;
  const lexer = AppState.results.lexer;
  const parser = AppState.results.parser;
  const semantic = AppState.results.semantic;
  const icg = AppState.results.icg;
  const opt = AppState.results.optimizer;
  const cg = AppState.results.codegen;
  const vmOutput = vmInstance ? vmInstance.outputBuffer.join('\n') : '';

  const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CompilerLens Compilation & Execution Report</title>
  <style>
    body { font-family: 'Inter', sans-serif; background: #0b0f19; color: #f1f5f9; padding: 30px; line-height: 1.6; }
    h1, h2, h3 { color: #00f2fe; }
    pre { background: #03060a; padding: 14px; border-radius: 8px; border: 1px solid #1e293b; overflow-x: auto; font-family: 'JetBrains Mono', monospace; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #334155; padding: 8px 12px; text-align: left; }
    th { background: #1e293b; color: #38bdf8; }
    .badge { background: #0284c7; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 12px; }
    .section { margin-bottom: 40px; border-bottom: 1px solid #1e293b; padding-bottom: 20px; }
  </style>
</head>
<body>
  <h1>CompilerLens — Full Compilation & Execution Report</h1>
  <p>Generated at: ${new Date().toLocaleString()}</p>

  <div class="section">
    <h2>1. Source Program</h2>
    <pre>${escapeHtml(code)}</pre>
  </div>

  <div class="section">
    <h2>2. Phase 1: Lexical Analysis</h2>
    <p>Total Tokens: ${lexer ? lexer.stats.totalTokens : 0} | Lines: ${lexer ? lexer.stats.linesOfCode : 0}</p>
    <table>
      <thead><tr><th>#</th><th>Lexeme</th><th>Type</th><th>Line:Col</th></tr></thead>
      <tbody>
        ${(lexer ? lexer.tokens : []).slice(0, 50).map((t, idx) => `<tr><td>${idx+1}</td><td>${escapeHtml(String(t.value))}</td><td>${t.type}</td><td>${t.line}:${t.col}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>3. Phase 2: Syntax Analysis (AST)</h2>
    <pre>${escapeHtml(parser ? Parser.toTextTree(parser.ast) : '')}</pre>
  </div>

  <div class="section">
    <h2>4. Phase 3: Semantic Analysis</h2>
    <table>
      <thead><tr><th>Identifier</th><th>Type</th><th>Kind</th><th>Scope</th><th>Line</th></tr></thead>
      <tbody>
        ${(semantic ? semantic.symbolTables : []).map(s => `<tr><td>${s.name}</td><td>${s.type}</td><td>${s.kind}</td><td>${s.scopeName}</td><td>${s.line}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>5. Phase 4: Intermediate Code (TAC)</h2>
    <pre>${escapeHtml(icg ? icg.instructions.map(i => i.toString()).join('\n') : '')}</pre>
  </div>

  <div class="section">
    <h2>6. Phase 5: Optimized TAC & Ledger</h2>
    <pre>${escapeHtml(opt ? opt.afterTAC.map(i => i.toString()).join('\n') : '')}</pre>
  </div>

  <div class="section">
    <h2>7. Phase 6 & 7: Target Assembly Code</h2>
    <pre>${escapeHtml(cg ? cg.optimizedAssembly.map(i => i.toString()).join('\n') : '')}</pre>
  </div>

  <div class="section">
    <h2>8. Execution Output (VM Run)</h2>
    <pre>${escapeHtml(vmOutput)}</pre>
  </div>
</body>
</html>`;

  const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compilerlens_report_${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
