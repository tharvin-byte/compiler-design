# MiniRuby Migration Plan & Milestones

**Date:** 2026-11-03  
**Project:** MiniRuby Compiler Migration  
**Spec Reference:** `docs/superpowers/specs/2026-11-03-miniruby-compiler-design.md`  

---

## Migration Steps & Implementation Order

### Step 1: Lexical Analysis Engine (`lexer.js`)
- [ ] Define MiniRuby keywords: `def`, `end`, `if`, `elsif`, `else`, `while`, `return`, `puts`, `print`, `gets`, `true`, `false`, `nil`, `and`, `or`, `not`, `break`, `next`.
- [ ] Support single-line comments `# ...` and multi-line comments `=begin ... =end`.
- [ ] Tokenize `**` (exponentiation) and compound operators `+=`, `-=`, `*=`, `/=`, `%=`.
- [ ] Tokenize newlines `\n` as `NEWLINE` statement separators (while collapsing multiple blank lines).
- [ ] Produce accurate line and column coordinates for all tokens.

### Step 2: Syntax Analysis & AST Construction (`parser.js`)
- [ ] Implement recursive-descent parser for MiniRuby statements separated by newlines or semicolons.
- [ ] Parse `def name(params) ... end` functions.
- [ ] Parse `if cond ... elsif cond ... else ... end` conditional blocks.
- [ ] Parse `while cond ... end` loops.
- [ ] Parse assignments (`x = expr`, `x += expr`), expression statements, and `return expr`.
- [ ] Parse `puts expr` and `print expr` statements (both with and without parentheses).
- [ ] Implement Pratt / precedence climbing expression parser supporting:
  - Exponentiation `**` (highest precedence, right-associative)
  - Unary `!`, `-`, `not`
  - Multiplicative `*`, `/`, `%`
  - Additive `+`, `-`
  - Relational `<`, `<=`, `>`, `>=`
  - Equality `==`, `!=`
  - Logical `&&`, `and`, `||`, `or`
- [ ] Provide syntax error reporting with line/column coordinates and synchronization on missing `end` or invalid expressions.
- [ ] Generate AST layout coordinates for SVG tree visualization.

### Step 3: Semantic Analysis & Dynamic Symbol Table (`semantic.js`)
- [ ] Support dynamic variable typing: define variables upon assignment in the active scope.
- [ ] Infer types: `Integer`, `Float`, `String`, `Boolean`, `Nil`.
- [ ] Detect undefined variables in expressions (e.g. `x + undefined_var` -> error).
- [ ] Validate type compatibility for arithmetic operators (e.g. String + String = String; String * Integer = String; String - Integer -> error).
- [ ] Validate function definitions, call argument counts, and return statements.
- [ ] Maintain scoped symbol table (Global, Function scopes) with variable and function symbols for the UI.
- [ ] Provide actionable compiler diagnostics and quick-fix suggestions.

### Step 4: Intermediate Code Generation & CFG (`icg.js`)
- [ ] Emit TAC for assignments, binary operators including `**`, unary operators.
- [ ] Emit TAC for `puts` (print with newline), `print` (print raw), and `gets` (input).
- [ ] Emit TAC labels and jumps for `if`, `elsif`, `else`, and `while`.
- [ ] Support function definitions, `param`, `call`, and `return`.
- [ ] Generate basic blocks and Control Flow Graph (CFG) with SVG coordinates.

### Step 5: Code Optimization (`optimizer.js`)
- [ ] Add constant folding for `**` exponentiation (e.g. `10 + 20 * 2` -> `50`, `2 ** 3` -> `8`).
- [ ] Constant propagation, algebraic simplification, and dead code elimination.
- [ ] Maintain Before/After diff and Optimization Action Ledger.

### Step 6: Target Code Generation & Peephole Optimizer (`codegen.js`)
- [ ] Emit virtual assembly instructions (R0-R7, SP, FP) for MiniRuby TAC.
- [ ] Implement `POW` opcode for exponentiation.
- [ ] Handle `PUTS` vs `PRINT` instructions.
- [ ] Target peephole optimization passes (redundant moves, strength reduction, dead jumps).

### Step 7: Virtual Machine & Dual-Run AST Verification (`vm.js`)
- [ ] Add `POW` opcode emulation in `VirtualMachine` (`Math.pow(r1, r2)`).
- [ ] Support string concatenation and formatted output in VM.
- [ ] Update `ASTInterpreter` to execute MiniRuby AST directly and verify VM output ("Verified ✓").

### Step 8: Frontend UI & Editor Updates (`index.html`, `ui.js`, `style.css`)
- [ ] Rename branding and labels to **MiniRuby Compiler**.
- [ ] Update code editor syntax highlighting for Ruby keywords, `#` comments, strings, defs.
- [ ] Provide 10 rich Ruby examples (Default, Hello World, Factorial, Fibonacci, Precedence & Exponentiation, Conditionals, Loops, Optimization, Semantic Error, Syntax Error).
- [ ] Update phase documentation and explanations across tabs.

### Step 9: Comprehensive Test Suite & Verification
- [ ] Update and execute test cases for:
  - Test 1: Basic Arithmetic (`puts result` -> `30`)
  - Test 2: Operator Precedence (`10 + 5 * 2` -> `20`, `2 ** 3 * 2` -> `16`)
  - Test 3: Conditional Statements (`if ... else ... end` -> `Greater`)
  - Test 4: While Loop (`while x <= 3 ... end` -> `1, 2, 3`)
  - Test 5: Function Definition & Call (`def add(a, b) ... end` -> `30`)
  - Test 6: Invalid Syntax (Missing `end` reported)
  - Test 7: Semantic Error (Undefined variable reported)
  - Test 8: Constant Folding (`10 + 20 * 2` -> `result = 50`)
- [ ] Run full automated verification suite and browser simulation.

### Step 10: Documentation & Final Report
- [ ] Update `README.md` with MiniRuby language specification, architecture, and usage instructions.
- [ ] Prepare final implementation report.

