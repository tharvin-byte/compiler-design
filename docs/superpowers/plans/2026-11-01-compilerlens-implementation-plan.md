# CompilerLens Implementation Plan

**Date:** 2026-11-01  
**Project:** CompilerLens (Single-Page Interactive 7-Phase Compiler & Virtual Machine)  
**Spec Reference:** `docs/superpowers/specs/2026-11-01-compilerlens-design.md`

---

## Task Breakdown & Execution Milestones

### Milestone 1: App Foundation & Design System (`index.html`, `style.css`)
- [ ] Create semantic HTML layout with hero header, pipeline stepper rail, code editor panel, tabbed 7-phase visualizer panels, VM execution console, and export modal.
- [ ] Implement dark obsidian & light slate theme system with CSS variables.
- [ ] Style 7-phase glowing pipeline stepper with animated pulse effect.
- [ ] Setup typography ("Inter", "JetBrains Mono"), glassmorphism, responsive grid, and custom SVG filters/defs.

### Milestone 2: Lexical Analysis Engine (`lexer.js`)
- [ ] Build regex and character scanning tokenizer for C-subset keywords, identifiers, numbers, strings, operators, punctuation.
- [ ] Track source line and column numbers for every token.
- [ ] Strip and count single-line (`//`) and multi-line (`/* */`) comments.
- [ ] Generate token table data and token frequency statistics.
- [ ] Implement friendly lexical error diagnostics (unterminated strings, unrecognized characters).

### Milestone 3: Syntax Analysis & AST Visualizer (`parser.js`)
- [ ] Implement recursive-descent parser with Pratt / precedence climbing expression parsing.
- [ ] Construct comprehensive AST nodes with source coordinate spans.
- [ ] Build syntax error synchronization and recovery for multi-error reporting.
- [ ] Implement compact text tree generator.
- [ ] Implement tree coordinate layout calculator for SVG rendering.

### Milestone 4: Semantic Analysis & Symbol Table (`semantic.js`)
- [ ] Implement hierarchical scope management (Global, Function, Block).
- [ ] Record symbols with identifier, type, kind, size, line, initialized flag.
- [ ] Perform type checking, undeclared/redeclared variable detection, parameter count/type matching, missing return checks, and implicit int-to-float conversions.
- [ ] Generate one-click quick fixes for common errors (e.g., auto-declare missing variable).

### Milestone 5: Intermediate Code Generation & Control Flow Graph (`icg.js`)
- [ ] Generate Three-Address Code (TAC) quadruples with labels and temporaries for the entire program.
- [ ] Partition TAC into Basic Blocks via leader analysis.
- [ ] Construct Control Flow Graph (CFG) nodes and branch/loop edges.
- [ ] Layout CFG blocks for SVG diagram rendering.

### Milestone 6: Intermediate Code Optimizer (`optimizer.js`)
- [ ] Implement optimization passes: Constant Folding, Constant Propagation, Algebraic Simplification, Common Subexpression Elimination (CSE), Dead Code Elimination (DCE), Unreachable Code Removal, and Loop-Invariant Code Motion (LICM).
- [ ] Generate side-by-side Before vs. After diff with line-level change colorization (green/red).
- [ ] Maintain an Optimization Action Ledger documenting each rule fired with source line references.

### Milestone 7: Target Code Generation & Peephole Optimizer (`codegen.js`)
- [ ] Map TAC to virtual register machine assembly (R0–R7, SP, FP).
- [ ] Implement register allocation and stack frame calling conventions for functions and recursion.
- [ ] Add line-by-line explanatory commentary to assembly instructions.
- [ ] Implement target peephole optimization passes (redundant load/store, strength reduction, branch-to-next, redundant moves) and calculate instruction savings.

### Milestone 8: Virtual Machine & Dual-Execution Engine (`vm.js`)
- [ ] Build 64KB memory emulator, register file (R0–R7, PC, SP, FP, Flags), and stack frame manager.
- [ ] Implement instruction execution loop with 1,000,000 cycle watchdog against infinite loops.
- [ ] Implement interactive step-by-step execution, run, pause, reset, and speed control.
- [ ] Implement console I/O buffering and interactive `scanf`/`input` modal prompt.
- [ ] Implement dual-execution AST reference interpreter to cross-verify VM execution output and produce the "Verified ✓" badge.

### Milestone 9: UI Orchestration & Micro-Animations (`ui.js`)
- [ ] Build code editor with line numbers gutter, syntax coloring, bracket matching, auto-indent, and error squiggles.
- [ ] Implement interactive SVG AST viewer with pan, zoom, click-to-collapse subtrees, and hover-to-code highlight.
- [ ] Implement interactive SVG CFG viewer with styled basic blocks and curved arrows.
- [ ] Wire up example loader (Default, Factorial, Fibonacci, Bubble Sort, Prime Checker, Optimization Demo, Error Demos).
- [ ] Implement pipeline pulse animation, step transitions, register flash animations.
- [ ] Implement Export Report (downloadable standalone HTML compilation report) and LocalStorage persistence.

### Milestone 10: End-to-End Testing & Verification
- [ ] Verify default example (arithmetic, square function, loops).
- [ ] Verify recursive `factorial(5) == 120`.
- [ ] Verify Fibonacci sequence up to 10 terms.
- [ ] Verify Bubble sort on 6-element array.
- [ ] Verify Prime checker with nested loops.
- [ ] Verify semantic error reporting and quick fix.
- [ ] Verify syntax error recovery.
- [ ] Verify runtime error (division by zero, out of bounds).
- [ ] Verify infinite loop watchdog guard.
