const assert = require('assert');
const { Lexer } = require('./lexer.js');
const { Parser } = require('./parser.js');
const { SemanticAnalyzer } = require('./semantic.js');
const { ICGGenerator } = require('./icg.js');
const { TACOptimizer } = require('./optimizer.js');
const { CodeGenerator } = require('./codegen.js');
const { VirtualMachine } = require('./vm.js');

console.log('Testing MiniRuby Multiple-Run VM Execution & Phase Updates...\n');

// 1. Multiple-Run Test on VM
const code = `def square(n)
  return n * n
end

x = square(4)
puts x`;

const lexer = new Lexer(code);
const tokenRes = lexer.tokenize();
const parser = new Parser(tokenRes.tokens);
const parserRes = parser.parse();

const semantic = new SemanticAnalyzer();
const semanticRes = semantic.analyze(parserRes.ast, code);

// Verify Semantic Table contains both user functions and standard built-ins
assert(semanticRes.symbolTables.length >= 3, `Expected >= 3 symbols, got ${semanticRes.symbolTables.length}`);
const putsSym = semanticRes.symbolTables.find(s => s.name === 'puts');
assert(putsSym, 'puts should be present in symbol table');
assert(putsSym.isBuiltin === true, 'puts should be marked isBuiltin');
assert(putsSym.line === 'built-in', 'puts line should be "built-in"');

const squareSym = semanticRes.symbolTables.find(s => s.name === 'square');
assert(squareSym, 'square should be in symbol table');
assert(squareSym.isBuiltin === false, 'square should not be builtin');

console.log('[PASS] Semantic Analysis correctly presents user and built-in symbols.');

// 2. ICG Test with Multiple Functions (CFG Unique IDs)
const icg = new ICGGenerator();
const icgRes = icg.generate(parserRes.ast);
assert(icgRes.functions.length === 2, 'Expected 2 functions (square and main)');

const allBlockIds = [];
for (const f of icgRes.functions) {
  for (const b of f.blocks) {
    allBlockIds.push(b.id);
  }
}
const uniqueBlockIds = new Set(allBlockIds);
assert.strictEqual(allBlockIds.length, uniqueBlockIds.size, `Block IDs must be globally unique across all functions: ${allBlockIds.join(', ')}`);
console.log(`[PASS] CFG Basic Block IDs are globally unique (${allBlockIds.join(', ')}).`);

// 3. VM Multiple Run Test
const optimizer = new TACOptimizer();
const optRes = optimizer.optimize(icgRes);

const codegen = new CodeGenerator();
const codegenRes = codegen.generate(optRes.functions);

const vm = new VirtualMachine();
vm.load(codegenRes.optimizedAssembly);

for (let run = 1; run <= 5; run++) {
  const result = vm.runSynchronous();
  assert.strictEqual(result.output.length, 1, `Run ${run}: Expected 1 output line`);
  assert.strictEqual(result.output[0], 16, `Run ${run}: Output mismatch`);
  assert.strictEqual(result.stats.exitCode, 0, `Run ${run}: Exit code should be 0`);
  assert.strictEqual(vm.isHalted, true, `Run ${run}: Should be halted after completion`);
  // Calling startAutoPlay or step automatically resets when halted!
  vm.step(); // should reset and step to PC 1
  assert.strictEqual(vm.isHalted, false, `Run ${run}: Step after halt should reset and continue`);
}

console.log('[PASS] Virtual Machine ran 5 consecutive cycles seamlessly without freezing!');

console.log('\nALL SPECIALIZED TESTS COMPLETED WITH 100% SUCCESS!');
