const fs = require('fs');
const assert = require('assert');

const { Lexer } = require('./lexer.js');
const { Parser } = require('./parser.js');
const { SemanticAnalyzer } = require('./semantic.js');
const { ICGGenerator } = require('./icg.js');
const { TACOptimizer } = require('./optimizer.js');
const { CodeGenerator } = require('./codegen.js');
const { VirtualMachine, ASTInterpreter } = require('./vm.js');

console.log('====================================================');
console.log('   CompilerLens Comprehensive Verification Suite   ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
  }
}

// 1. Verify files exist
test('All 10 required modular files exist', () => {
  const files = [
    'index.html', 'style.css', 'lexer.js', 'parser.js', 'semantic.js',
    'icg.js', 'optimizer.js', 'codegen.js', 'vm.js', 'ui.js'
  ];
  for (const f of files) {
    assert(fs.existsSync(f), `File missing: ${f}`);
    assert(fs.statSync(f).size > 100, `File too small: ${f}`);
  }
});

// Helper for full pipeline
function compileAndRun(code, maxInst = 1000000) {
  const lexer = new Lexer(code).tokenize();
  if (lexer.errors.length) return { phase: 'Lexer', errors: lexer.errors };
  
  const parser = new Parser(lexer.tokens).parse();
  if (parser.errors.length) return { phase: 'Parser', errors: parser.errors };
  
  const semantic = new SemanticAnalyzer().analyze(parser.ast, code);
  if (semantic.errors.length) return { phase: 'Semantic', errors: semantic.errors, quickFixes: semantic.quickFixes };
  
  const icg = new ICGGenerator().generate(parser.ast);
  const opt = new TACOptimizer().optimize(icg);
  const cg = new CodeGenerator().generate(opt.functions);
  
  const vm = new VirtualMachine({ maxInstructions: maxInst }).load(cg.optimizedAssembly);
  const vmRes = vm.runSynchronous();
  const astRes = new ASTInterpreter().run(parser.ast);
  
  return {
    phase: 'Success',
    vmOutput: vmRes.output,
    astOutput: astRes.output,
    matches: JSON.stringify(vmRes.output) === JSON.stringify(astRes.output),
    savedTAC: opt.stats.savedCount,
    savedAsm: cg.savedCount,
    stats: vmRes.stats,
    rawAsmCount: cg.rawAssembly.length,
    optAsmCount: cg.optimizedAssembly.length
  };
}

// 2. Default Example
test('Default Example (Square, Arithmetic b+c*2, For Loop)', () => {
  const code = `int square(int n) { return n * n; }
int main() {
    int b = 5; int c = 10;
    int a = b + c * 2;
    print(a);
    for (int i = 1; i <= 3; i++) { print(square(i)); }
    return 0;
}`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [25, 1, 4, 9]);
  assert.strictEqual(res.matches, true);
  assert(res.savedTAC > 0, 'TAC optimizer should eliminate dead code/temporaries');
  assert(res.savedAsm > 0, 'Peephole optimizer should save instructions');
});

// 3. Factorial recursion
test('Recursive Factorial (5! == 120)', () => {
  const code = `int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
int main() {
    print(factorial(5));
    return 0;
}`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [120]);
  assert.strictEqual(res.matches, true);
});

// 4. Fibonacci recursion
test('Fibonacci Series (first 7 terms)', () => {
  const code = `int fib(int n) {
    if (n <= 0) return 0;
    if (n == 1) return 1;
    return fib(n - 1) + fib(n - 2);
}
int main() {
    for (int i = 0; i < 7; i++) {
        print(fib(i));
    }
    return 0;
}`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [0, 1, 1, 2, 3, 5, 8]);
  assert.strictEqual(res.matches, true);
});

// 5. Bubble sort on 6 elements array
test('Bubble Sort on Array of 6 numbers', () => {
  const code = `int main() {
    int arr[6] = {64, 25, 12, 22, 11, 90};
    for (int i = 0; i < 6; i++) {
        for (int j = 0; j < 5; j++) {
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
    for (int k = 0; k < 6; k++) {
        print(arr[k]);
    }
    return 0;
}`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [11, 12, 22, 25, 64, 90]);
  assert.strictEqual(res.matches, true);
});

// 6. Prime number checker with nested loops
test('Prime Number Checker with nested loops', () => {
  const code = `int isPrime(int n) {
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
}`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [2, 3, 5, 7, 11, 13]);
  assert.strictEqual(res.matches, true);
});

// 7. Semantic Error & Quick Fix
test('Semantic Diagnostics: Undeclared variable & Quick Fix', () => {
  const code = `int main() { int a = b + c; return 0; }`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Semantic');
  assert.strictEqual(res.errors.length, 2);
  assert(res.errors[0].message.includes("Undeclared identifier 'b'"));
  assert(res.quickFixes.length >= 2);
  assert(res.quickFixes[0].patch.includes('int b = 0;'));
});

// 8. Syntax Error Recovery
test('Syntax Diagnostics: Missing semicolon error recovery', () => {
  const code = `int main() { int a = 5 int b = 10; return 0; }`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Parser');
  assert(res.errors.length > 0);
  assert(res.errors[0].message.includes("Missing ';'"));
});

// 9. Runtime Error: Division by Zero
test('Runtime Diagnostics: Division by zero', () => {
  const code = `int main() { int x = 42; int y = 0; int z = x / y; print(z); return 0; }`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert(res.vmOutput.some(line => String(line).includes('Division by zero')));
});

// 10. Infinite Loop Guard Watchdog
test('Safety Watchdog: Infinite loop halting at limit', () => {
  const code = `int main() { while (1) {} return 0; }`;
  const res = compileAndRun(code, 5000);
  assert.strictEqual(res.phase, 'Success');
  assert(res.vmOutput.some(line => String(line).includes('Execution stopped: possible infinite loop')));
});

// 11. Target Peephole Optimizer Instruction Reduction
test('Phase 7 Peephole Optimizer saves instructions', () => {
  const code = `int main() { int x = 10; int y = x * 2; print(y); return 0; }`;
  const res = compileAndRun(code);
  assert(res.savedAsm >= 1, `Expected peephole savings, got ${res.savedAsm}`);
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
if (passedTests === totalTests) {
  console.log('ALL VERIFICATION CHECKS PASSED PERFECTLY!');
  process.exit(0);
} else {
  console.error('SOME CHECKS FAILED!');
  process.exit(1);
}
