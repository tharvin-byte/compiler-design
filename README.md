# MiniRuby Compiler — 7-Phase Compiler & Target Virtual Machine

A complete, pedagogical, interactive 7-phase compiler and target virtual machine for **MiniRuby**, an expressive subset of the Ruby programming language. Built entirely from scratch in vanilla HTML5, CSS3, and ES6+ JavaScript with zero external frameworks or fake compiler data.

---

## 1. Project Overview

The **MiniRuby Compiler** migrates and elevates a classic seven-phase compiler architecture into a genuine dynamic compiler capable of lexing, parsing, analyzing, optimizing, and executing actual Ruby source code.

Every compiler phase dynamically computes its representations directly from user-submitted Ruby source code:
1. **Lexical Analysis (Phase 1):** Token stream classification with keyword recognition, Ruby `#` and `=begin...=end` comments, and location tracking.
2. **Syntax Analysis (Phase 2):** Recursive-descent AST parser with operator precedence, Ruby `end` block termination, text tree view, and interactive Reingold-Tilford SVG layout.
3. **Semantic Analysis (Phase 3):** Dynamic scoping, symbol tables, undefined variable detection, and operator compatibility checks.
4. **Intermediate Code Generation (Phase 4):** Three-Address Code (TAC) quadruples grouped into basic blocks and interactive Control Flow Graph (CFG).
5. **Code Optimization (Phase 5):** Multi-pass constant folding (including exponentiation `**`), constant propagation, algebraic simplification, and Dead Code Elimination (DCE).
6. **Code Generation (Phase 6):** 8-register target machine assembly emission with stack frame prologue/epilogue (`FP`, `SP`), `POW`, `PUTS`, and `PRINT`.
7. **Target Optimization (Phase 7):** Peephole optimization passes on generated assembly with before/after diffs and savings metrics.
8. **Virtual Machine & AST Dual-Run Execution:** Interactive 8-register stack virtual machine featuring PC highlight, live register inspection, call stack visualization, and dual-run AST reference validation.

---

## 2. MiniRuby Language Scope & Grammar

### Supported Language Features

- **Variables & Dynamic Assignment:** Dynamic typing without explicit declarations (`x = 10`, `name = "Ruby"`, `result = x + y`).
- **Data Types:** Integer, Float, String (concatenation & repetition), Boolean (`true`, `false`), and Nil (`nil`).
- **Arithmetic Operators:** `+`, `-`, `*`, `/`, `%`, and `**` (exponentiation with right-associativity and proper precedence).
- **Relational & Logical Operators:** `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`.
- **Compound Assignment:** `+=`, `-=`, `*=`, `/=`, `%=`, `**=`.
- **I/O Functions:** `puts` (with automatic newline), `print`, and `gets` (with `.to_i` and `.to_f` conversions).
- **Conditionals:** `if ... elsif ... else ... end` branches.
- **Loops:** `while ... end` loops with condition evaluation.
- **Functions:** `def name(args) ... return expr ... end` definitions and function calls.
- **Comments:** Single-line `# comment` and multi-line `=begin ... =end` block comments.

### Deliberate Simplifications

1. **Object-Oriented Constructs:** Classes and object inheritance are omitted in favor of procedural functions (`def ... end`) to emphasize compiler pipeline principles.
2. **Dynamic Metaprogramming:** `eval`, `send`, and method missing are excluded to allow static basic block partitioning and optimization.
3. **Block Closures / Lambdas:** Ruby blocks (`do |x| ... end` or `{ |x| ... }`) are restricted to standard function definitions and calls.

---

## 3. Seven Compiler Phases Breakdown

### Phase 1: Lexical Analyzer (`lexer.js`)
- Recognizes Ruby keywords: `def`, `end`, `if`, `elsif`, `else`, `while`, `return`, `puts`, `print`, `gets`, `true`, `false`, `nil`.
- Handles `#` single-line comments and `=begin ... =end` multi-line block comments.
- Accurately tracks line, column, length, and original lexeme for every token.
- Treats newlines `\n` and semicolons `;` as statement separators, avoiding unnecessary separators after binary operators.

### Phase 2: Syntax Analyzer (`parser.js`)
- Constructs an Abstract Syntax Tree (AST) representing statements, expressions, and blocks.
- Employs precedence climbing for binary operators:
  - Precedence 7: `**` (Right-associative)
  - Precedence 6: Unary `-`, `!`
  - Precedence 5: `*`, `/`, `%`
  - Precedence 4: `+`, `-`
  - Precedence 3: `<`, `<=`, `>`, `>=`
  - Precedence 2: `==`, `!=`
  - Precedence 1: `&&`, `||`
  - Precedence 0: Assignments (`=`, `+=`, etc.)
- Enforces Ruby `end` termination for `if`, `while`, and `def` constructs, emitting accurate line-numbered syntax errors with quick-fix suggestions if omitted.
- Generates ASCII text trees and computes Reingold-Tilford tidy tree coordinates for interactive SVG rendering.

### Phase 3: Semantic Analyzer (`semantic.js`)
- Dynamic variable typing: Variables are defined on first assignment without requiring explicit type declarations.
- Undefined variable detection: Identifies references to unassigned variables in expressions and flags precise line/column errors with quick-fix recommendations.
- Validates function call arity and argument compatibility.
- Scoped symbol table maintaining both user-defined symbols and built-ins (`puts`, `print`, `gets`, `to_i`, `to_f`).

### Phase 4: Intermediate Code Generator (`icg.js`)
- Converts the AST into linear Three-Address Code (TAC) quadruples (`op, arg1, arg2, result`).
- Supports exponentiation (`**`), function definitions (`FUNC_BEGIN`, `FUNC_END`), calls (`PARAM`, `CALL`), and conditional jumps (`IF_FALSE_GOTO`, `GOTO`).
- Groups instructions by function, partitions them into Basic Blocks by leader detection, and constructs a visual Control Flow Graph (CFG) with SVG coordinates.

### Phase 5: Intermediate Code Optimizer (`optimizer.js`)
- **Constant Folding:** Compile-time evaluation of constant expressions, including `Math.pow` for `**` (e.g. `10 + 20 * 2 => 50`).
- **Algebraic Simplification:** `x ** 0 => 1`, `x ** 1 => x`, `x * 1 => x`, `x + 0 => x`, `x - 0 => x`.
- **Constant Propagation:** Propagates constant bindings through basic blocks.
- **Dead Code Elimination (DCE):** Eliminates dead temporaries and unused variable assignments.
- Maintains an Optimization Action Ledger recording each rule, original code, transformed code, and instruction savings.

### Phase 6: Code Generator (`codegen.js`)
- Generates target assembly for an 8-register virtual machine (`R0`–`R7`, `SP`, `FP`, `PC`).
- Manages activation records, stack frame creation (`PUSH FP; MOV FP, SP; SUB SP, n`), and clean function epilogues.
- Implements `POW` for exponentiation, `PUTS` and `PRINT` for terminal output, and arithmetic opcodes (`ADD`, `SUB`, `MUL`, `DIV`, `MOD`).

### Phase 7: Target Code Optimization (Peephole)
- Multi-pass assembly peephole optimization:
  - Redundant store-load removal (`STORE [FP-4], R0; LOAD R0, [FP-4]` => `STORE [FP-4], R0`).
  - Redundant jump elimination (`JMP L1; L1:` => `L1:`).
  - Identity arithmetic elimination (`ADD R0, 0` => eliminated).
  - Unreachable instructions following unconditional jumps.

### Execution & Verification Engine (`vm.js`)
- **Virtual Machine:** Executes target assembly with step-by-step interactive controls, adjustable playback speed, live register display, and call stack visualization.
- **AST Reference Interpreter:** Dual-executes the raw AST independently. Compares outputs with the VM to display an authentic `Verified ✓` badge when results match.

---

## 4. Verification & Test Suite

The project includes four distinct automated test suites:

### 1. Mandatory Specification Test Suite (`test_cases.js`)
Validates all 8 core test cases from the specification plus extended Ruby features:
```bash
node test_cases.js
```
- **Test 1:** Basic Arithmetic and Assignment (`x = 10; y = 20; result = x + y; puts result`) -> `30`
- **Test 2:** Exponentiation Operator (`base = 2; exp = 8; result = base ** exp; puts result`) -> `256`
- **Test 3:** Conditional Statement (`if x > 10 puts "Greater" else puts "Smaller" end`) -> `"Greater"`
- **Test 4:** Loop Execution (`while x < 3 puts x; x = x + 1 end`) -> `0, 1, 2`
- **Test 5:** Function Definition & Call (`def add(a, b) return a + b end; puts add(10, 20)`) -> `30`
- **Test 6:** Syntax Error Reporting (Missing `end` on `if x > 5 puts "Hello"`) -> Caught with line info
- **Test 7:** Semantic Error Reporting (Undefined variable reference) -> Caught with line:col info
- **Test 8:** Constant Folding Optimization (`result = 10 + 20 * 2` folded to `50`) -> Verified in TAC
- **Tests 9-12:** Multi-branch `elsif`, block comments `=begin...=end`, string concatenation, and recursive Fibonacci.

### 2. Full Architecture Verification (`verify_all.js`)
Verifies file structure, DOM element bindings, and execution of all 13 core program types:
```bash
node verify_all.js
```

### 3. Multi-Run & Concurrency Test (`verify_multirun_and_features.js`)
Verifies 5 consecutive runs on the virtual machine without memory leaks, state bleeding, or UI freezes:
```bash
node verify_multirun_and_features.js
```

### 4. Headless Browser DOM Integration (`verify_browser.js`)
Simulates the browser DOM environment in Node.js to verify step badges, DOM binding, and dual-run AST verification:
```bash
node verify_browser.js
```

---

## 5. Running the Application

### Option A: Interactive Web UI
Start the local server:
```bash
node server.js
```
Then navigate to `http://localhost:3000` in any web browser.

### Option B: Run All Automated Tests
```bash
node test_cases.js && node verify_all.js && node verify_multirun_and_features.js && node verify_browser.js
```
All suites report 100% pass rates across all compiler phases.

