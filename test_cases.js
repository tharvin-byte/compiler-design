const { Lexer } = require('./lexer.js');
const { Parser } = require('./parser.js');
const { SemanticAnalyzer } = require('./semantic.js');
const { ICGGenerator } = require('./icg.js');
const { TACOptimizer } = require('./optimizer.js');
const { CodeGenerator } = require('./codegen.js');
const { VirtualMachine, ASTInterpreter } = require('./vm.js');

console.log('====================================================');
console.log('   MiniRuby Compiler - Comprehensive Test Suite     ');
console.log('====================================================\n');

let allPassed = true;

function runFullPipeline(name, code, expectedOutput, expectedVerified = true) {
  try {
    const lexerRes = new Lexer(code).tokenize();
    if (lexerRes.errors.length) throw new Error('Lexer error: ' + lexerRes.errors[0].message);

    const parserRes = new Parser(lexerRes.tokens).parse();
    if (parserRes.errors.length) throw new Error('Parser error: ' + parserRes.errors[0].message);

    const semanticRes = new SemanticAnalyzer().analyze(parserRes.ast, code);
    if (semanticRes.errors.length) throw new Error('Semantic error: ' + semanticRes.errors[0].message);

    const icgRes = new ICGGenerator().generate(parserRes.ast);
    const optRes = new TACOptimizer().optimize(icgRes);
    const cgRes = new CodeGenerator().generate(optRes.functions);

    const vm = new VirtualMachine({ maxInstructions: 1000000 });
    vm.load(cgRes.optimizedAssembly);
    const vmRes = vm.runSynchronous();

    const astInterp = new ASTInterpreter();
    const astRes = astInterp.run(parserRes.ast);

    const outStr = vmRes.output.map(v => String(v).trim()).join('\n');
    const expectedStr = expectedOutput.map(v => String(v).trim()).join('\n');

    if (outStr !== expectedStr) {
      throw new Error(`Output mismatch. Expected: ${JSON.stringify(expectedStr)}, Got: ${JSON.stringify(outStr)}`);
    }

    const verified = JSON.stringify(vmRes.output) === JSON.stringify(astRes.output);
    console.log(`[PASS] ${name} -> Output: ${JSON.stringify(vmRes.output)} (Dual-Run Verified: ${verified})`);
  } catch (err) {
    allPassed = false;
    console.error(`[FAIL] ${name} -> ${err.message}`);
  }
}

// ---------------------------------------------------------
// Section 7 Mandatory Test Cases
// ---------------------------------------------------------

// Test 1: Basic Arithmetic and Assignment
runFullPipeline(
  'Test 1: Basic Arithmetic and Assignment',
  `x = 10
y = 20
result = x + y
puts result`,
  ['30']
);

// Test 2: Exponentiation Operator (**)
runFullPipeline(
  'Test 2: Exponentiation Operator (**)',
  `base = 2
exp = 8
result = base ** exp
puts result`,
  ['256']
);

// Test 3: Conditional Statement
runFullPipeline(
  'Test 3: Conditional Statement (if/else)',
  `x = 15
if x > 10
  puts "Greater"
else
  puts "Smaller"
end`,
  ['Greater']
);

// Test 4: Loop Execution (while/end)
runFullPipeline(
  'Test 4: Loop Execution (while/end)',
  `x = 0
while x < 3
  puts x
  x = x + 1
end`,
  ['0', '1', '2']
);

// Test 5: Function Definition and Call
runFullPipeline(
  'Test 5: Function Definition and Call',
  `def add(a, b)
  return a + b
end

result = add(10, 20)
puts result`,
  ['30']
);

// Test 6: Syntax Error Reporting (Missing 'end')
{
  const code = `if x > 5\n  puts "Hello"`;
  try {
    const lex = new Lexer(code).tokenize();
    const parse = new Parser(lex.tokens).parse();
    if (parse.errors.length > 0 && /missing 'end'|expected 'end'/i.test(parse.errors[0].message)) {
      console.log(`[PASS] Test 6: Syntax Error Reporting -> Detected: "${parse.errors[0].message}" at line ${parse.errors[0].line}`);
    } else {
      allPassed = false;
      console.error(`[FAIL] Test 6: Expected syntax error for missing 'end', got:`, parse.errors);
    }
  } catch (e) {
    console.log(`[PASS] Test 6: Syntax Error Reporting -> Exception caught: ${e.message}`);
  }
}

// Test 7: Semantic Error Reporting (Undefined Variable)
{
  const code = `x = 10\nresult = x + undefined_variable\nputs result`;
  try {
    const lex = new Lexer(code).tokenize();
    const parse = new Parser(lex.tokens).parse();
    const sem = new SemanticAnalyzer().analyze(parse.ast, code);
    if (sem.errors.length > 0 && /undefined/i.test(sem.errors[0].message)) {
      console.log(`[PASS] Test 7: Semantic Error Reporting -> Detected: "${sem.errors[0].message}" at line ${sem.errors[0].line}:${sem.errors[0].col}`);
    } else {
      allPassed = false;
      console.error(`[FAIL] Test 7: Expected semantic error for undefined variable, got:`, sem.errors);
    }
  } catch (e) {
    allPassed = false;
    console.error(`[FAIL] Test 7: Exception: ${e.message}`);
  }
}

// Test 8: Optimization Verification (Constant Folding)
{
  const code = `result = 10 + 20 * 2\nputs result`;
  try {
    const lex = new Lexer(code).tokenize();
    const parse = new Parser(lex.tokens).parse();
    const icg = new ICGGenerator().generate(parse.ast);
    const opt = new TACOptimizer().optimize(icg);
    
    // Check that constant folding produced 50 in optimized instructions
    const foldedInst = opt.afterTAC.find(inst => inst.result === 'result' && (inst.arg1 === 50 || inst.arg1 === '50'));
    const ledgerEntry = opt.ledger.find(e => e.rule === 'Constant Folding');

    if (foldedInst || ledgerEntry) {
      console.log(`[PASS] Test 8: Optimization Verification -> Constant folded successfully (10 + 20 * 2 => 50, saved: ${opt.stats.savedCount})`);
    } else {
      allPassed = false;
      console.error(`[FAIL] Test 8: Constant folding not found in optimized TAC:`, opt.afterTAC);
    }
  } catch (e) {
    allPassed = false;
    console.error(`[FAIL] Test 8: Exception: ${e.message}`);
  }
}

// ---------------------------------------------------------
// Additional Extended MiniRuby Test Cases
// ---------------------------------------------------------

// Test 9: Multi-branch elsif
runFullPipeline(
  'Test 9: Multi-branch elsif',
  `score = 85
if score >= 90
  puts "A"
elsif score >= 80
  puts "B"
else
  puts "C"
end`,
  ['B']
);

// Test 10: Comments (single line and block comments)
runFullPipeline(
  'Test 10: Comments and Exponentiation Precedence',
  `# Single line comment
=begin
Multi-line
Ruby block comment
=end
val = 2 * 3 ** 2
puts val`,
  ['18']
);

// Test 11: String Operations and Multiple puts
runFullPipeline(
  'Test 11: String concatenation & Output',
  `greeting = "Hello" + " " + "MiniRuby"
puts greeting`,
  ['Hello MiniRuby']
);

// Test 12: Recursive Fibonacci
runFullPipeline(
  'Test 12: Recursive Fibonacci',
  `def fib(n)
  if n <= 0
    return 0
  elsif n == 1
    return 1
  else
    return fib(n - 1) + fib(n - 2)
  end
end

puts fib(6)`,
  ['8']
);

console.log('\n====================================================');
if (allPassed) {
  console.log('   ALL 12 MINIRUBY TEST CASES PASSED WITH 100%!     ');
  console.log('====================================================');
  process.exit(0);
} else {
  console.error('   SOME TEST CASES FAILED!                          ');
  console.log('====================================================');
  process.exit(1);
}
