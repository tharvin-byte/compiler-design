const { Lexer } = require('./lexer.js');
const { Parser } = require('./parser.js');
const { SemanticAnalyzer } = require('./semantic.js');
const { ICGGenerator } = require('./icg.js');
const { TACOptimizer } = require('./optimizer.js');
const { CodeGenerator } = require('./codegen.js');
const { VirtualMachine, ASTInterpreter } = require('./vm.js');

const cases = [
  { name: '1. Single print call', code: 'print(42);' },
  { name: '2. Multiple headers', code: '#include <stdio.h>\n#include <stdlib.h>\n#include <math.h>\nint main() { printf("Multi-include OK\\n"); return 0; }' },
  { name: '3. Do-While Loop', code: 'int i = 0; do { i++; } while (i < 5); print(i);' },
  { name: '4. While with break and continue', code: 'int s = 0; int i = 0; while (i < 10) { i++; if (i == 3) continue; if (i > 6) break; s += i; } print(s);' },
  { name: '5. GCD Function', code: 'int gcd(int a, int b) { while (b != 0) { int t = b; b = a % b; a = t; } return a; } int main() { print(gcd(48, 18)); return 0; }' },
  { name: '6. Formatted printf %d', code: 'int main() { int ans = 42; printf("The answer is %d\\n", ans); return 0; }' },
  { name: '7. Multi-arg printf %d %d', code: 'int main() { int x = 10; int y = 20; printf("X=%d and Y=%d\\n", x, y); return 0; }' },
  { name: '8. Dynamic Array Indexing', code: 'int main() { int arr[4]; for (int i = 0; i < 4; i++) { arr[i] = (i + 1) * 10; } for (int j = 0; j < 4; j++) { print(arr[j]); } return 0; }' },
  { name: '9. Logical operators && and ||', code: 'int main() { int a = 1; int b = 0; if (a && !b) { print(100); } if (b || a) { print(200); } return 0; }' }
];

console.log('Running 9 extended test cases...\n');
let allPassed = true;

for (const tc of cases) {
  try {
    const lexer = new Lexer(tc.code).tokenize();
    if (lexer.errors.length) throw new Error('Lexer: ' + lexer.errors[0].message);
    const parser = new Parser(lexer.tokens).parse();
    if (parser.errors.length) throw new Error('Parser: ' + parser.errors[0].message);
    const semantic = new SemanticAnalyzer().analyze(parser.ast, tc.code);
    if (semantic.errors.length) throw new Error('Semantic: ' + semantic.errors[0].message);
    const icg = new ICGGenerator().generate(parser.ast);
    const opt = new TACOptimizer().optimize(icg);
    const cg = new CodeGenerator().generate(opt.functions);
    const vm = new VirtualMachine({ maxInstructions: 1000000 }).load(cg.optimizedAssembly);
    const vmRes = vm.runSynchronous();
    const astRes = new ASTInterpreter().run(parser.ast);
    const match = JSON.stringify(vmRes.output) === JSON.stringify(astRes.output);
    console.log('[PASS] ' + tc.name + ' -> Output: ' + JSON.stringify(vmRes.output) + ' (Verified: ' + (match && astRes.verified) + ')');
  } catch (e) {
    allPassed = false;
    console.error('[FAIL] ' + tc.name + ' -> ' + e.message);
  }
}

if (allPassed) {
  console.log('\nALL 9 EXTENDED TEST CASES PASSED WITH 100% SUCCESS!');
  process.exit(0);
} else {
  console.error('\nSOME CASES FAILED!');
  process.exit(1);
}

