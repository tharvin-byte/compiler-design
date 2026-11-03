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
console.log('   MiniRuby Compiler Comprehensive Verification     ');
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

// 1b. Verify DOM Element IDs
test('DOM Element IDs in ui.js match index.html', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const ui = fs.readFileSync('./ui.js', 'utf8');
  const regex = /getElementById\(['"]([^'"]+)['"]\)/g;
  let m;
  const ids = [];
  while ((m = regex.exec(ui)) !== null) {
    ids.push(m[1]);
  }
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  assert.strictEqual(missing.length, 0, `Missing DOM IDs: ${missing.join(', ')}`);
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

// 2. Default MiniRuby Program
test('Default MiniRuby (Square, Arithmetic b+c*2, While Loop)', () => {
  const code = `def square(n)
  return n * n
end

b = 5
c = 10
a = b + c * 2
puts a

i = 1
while i <= 3
  puts square(i)
  i = i + 1
end`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [25, 1, 4, 9]);
  assert.strictEqual(res.matches, true);
  assert(res.savedTAC >= 0, 'TAC optimizer finished');
  assert(res.savedAsm >= 0, 'Peephole optimizer finished');
});

// 3. Factorial recursion
test('Recursive Factorial (5! == 120)', () => {
  const code = `def factorial(n)
  if n <= 1
    return 1
  else
    return n * factorial(n - 1)
  end
end

puts factorial(5)`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [120]);
  assert.strictEqual(res.matches, true);
});

// 4. Fibonacci recursion
test('Fibonacci Series (first 7 terms)', () => {
  const code = `def fib(n)
  if n <= 0
    return 0
  elsif n == 1
    return 1
  else
    return fib(n - 1) + fib(n - 2)
  end
end

i = 0
while i < 7
  puts fib(i)
  i = i + 1
end`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [0, 1, 1, 2, 3, 5, 8]);
  assert.strictEqual(res.matches, true);
});

// 5. Exponentiation Operator (**) & Precedence
test('Exponentiation Operator (**) & Precedence', () => {
  const code = `base = 2
exp = 8
puts base ** exp
val = 2 * 3 ** 2
puts val`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, [256, 18]);
  assert.strictEqual(res.matches, true);
});

// 6. Conditionals (if/elsif/else/end)
test('Conditionals if/elsif/else', () => {
  const code = `score = 85
if score >= 90
  puts "A"
elsif score >= 80
  puts "B"
else
  puts "C"
end`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.deepStrictEqual(res.vmOutput, ['B']);
  assert.strictEqual(res.matches, true);
});

// 7. Semantic Error & Quick Fix
test('Semantic Diagnostics: Undefined variable & Quick Fix', () => {
  const code = `x = 10\nresult = x + undefined_variable\nputs result`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Semantic');
  assert.strictEqual(res.errors.length, 1);
  assert(res.errors[0].message.includes("Undefined local variable or method 'undefined_variable'"));
  assert(res.quickFixes.length >= 1);
});

// 8. Syntax Error: Missing 'end'
test('Syntax Diagnostics: Missing end for if statement', () => {
  const code = `if x > 5\n  puts "Hello"`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Parser');
  assert(res.errors.length > 0);
  assert(res.errors[0].message.includes("Missing 'end'"));
});

// 9. Runtime Error: Division by Zero
test('Runtime Diagnostics: Division by zero', () => {
  const code = `x = 42\nzero = 0\ny = x / zero\nputs y`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert(res.vmOutput.some(line => String(line).includes('Division by zero')));
});

// 10. Infinite Loop Guard Watchdog
test('Safety Watchdog: Infinite loop halting at limit', () => {
  const code = `while true\nend`;
  const res = compileAndRun(code, 5000);
  assert.strictEqual(res.phase, 'Success');
  assert(res.vmOutput.some(line => String(line).includes('Execution stopped: possible infinite loop')));
});

// 11. Target Peephole Optimizer Instruction Reduction
test('Phase 7 Peephole Optimizer saves instructions', () => {
  const code = `x = 10\ny = x * 2\nputs y`;
  const res = compileAndRun(code);
  assert(res.savedAsm >= 1, `Expected peephole savings, got ${res.savedAsm}`);
});

// 12. String Concatenation & Multiple puts
test('MiniRuby String Concatenation and puts', () => {
  const code = `greeting = "Hello" + " " + "World"
puts greeting`;
  const res = compileAndRun(code);
  assert.strictEqual(res.phase, 'Success');
  assert.strictEqual(res.matches, true);
  assert.deepStrictEqual(res.vmOutput, ['Hello World']);
});

console.log(`\nResults: ${passedTests} / ${totalTests} tests passed.\n`);
if (passedTests === totalTests) {
  console.log('ALL VERIFICATION CHECKS PASSED PERFECTLY!');
  process.exit(0);
} else {
  console.error('SOME CHECKS FAILED!');
  process.exit(1);
}
