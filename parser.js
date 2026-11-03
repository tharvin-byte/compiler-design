/**
 * CompilerLens - MiniRuby Syntax Analyzer (parser.js)
 * Phase 2: Parses token stream into a hierarchical Abstract Syntax Tree (AST),
 * supports Ruby syntax (def/end, if/elsif/else/end, while/end, dynamic assignments,
 * exponentiation **, puts/print), detects missing 'end' block errors,
 * provides text tree generation, and computes coordinates for interactive SVG rendering.
 */

let astNodeIdCounter = 0;

class ASTNode {
  constructor(type, props = {}) {
    this.nodeId = ++astNodeIdCounter;
    this.type = type;
    Object.assign(this, props);
    if (!this.children) {
      this.children = [];
    }
    this.collapsed = false;
    // Coordinates for SVG visual layout
    this.x = 0;
    this.y = 0;
    this.subtreeWidth = 0;
  }

  updateChildren() {
    const list = [];
    switch (this.type) {
      case 'Program':
        return this.declarations || [];
      case 'FunctionDeclaration':
        if (this.params) list.push(...this.params);
        if (this.body) list.push(this.body);
        return list;
      case 'BlockStatement':
        return this.statements || [];
      case 'ExpressionStatement':
        return this.expression ? [this.expression] : [];
      case 'IfStatement':
        if (this.condition) list.push(this.condition);
        if (this.thenBranch) list.push(this.thenBranch);
        if (this.elsifBranches) {
          for (const b of this.elsifBranches) {
            if (b.condition) list.push(b.condition);
            if (b.body) list.push(b.body);
          }
        }
        if (this.elseBranch) list.push(this.elseBranch);
        return list;
      case 'WhileStatement':
        if (this.condition) list.push(this.condition);
        if (this.body) list.push(this.body);
        return list;
      case 'ReturnStatement':
        return this.argument ? [this.argument] : [];
      case 'BinaryExpression':
      case 'LogicalExpression':
      case 'AssignmentExpression':
        return [this.left, this.right].filter(Boolean);
      case 'UnaryExpression':
        return this.argument ? [this.argument] : [];
      case 'CallExpression':
        return [this.callee, ...(this.arguments || [])].filter(Boolean);
      case 'ArrayLiteral':
        return this.elements || [];
      case 'ArrayAccess':
        return [this.array, this.index].filter(Boolean);
      default:
        return this.children || [];
    }
  }

  getChildren() {
    this.children = this.updateChildren();
    return this.children;
  }
}

class Parser {
  constructor(tokens = []) {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];
    this.quickFixes = [];
    astNodeIdCounter = 0;
  }

  parse(tokens) {
    if (tokens !== undefined) {
      this.tokens = tokens;
    }
    this.current = 0;
    this.errors = [];
    this.quickFixes = [];
    astNodeIdCounter = 0;

    const programNode = new ASTNode('Program', {
      declarations: [],
      line: 1,
      col: 1
    });

    this.skipSeparators();

    while (!this.isAtEnd()) {
      try {
        const stmt = this.parseStatement();
        if (stmt) {
          programNode.declarations.push(stmt);
        }
      } catch (err) {
        this.synchronize();
      }
      this.skipSeparators();
    }

    if (programNode.declarations.length > 0) {
      const first = programNode.declarations[0];
      const last = programNode.declarations[programNode.declarations.length - 1];
      programNode.line = first.line;
      programNode.col = first.col;
      programNode.endLine = last.endLine || last.line;
      programNode.endCol = last.endCol || last.col;
    }

    programNode.getChildren();

    return {
      ast: programNode,
      errors: this.errors,
      quickFixes: this.quickFixes
    };
  }

  // -------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------

  parseStatement() {
    this.skipSeparators();
    if (this.isAtEnd()) return null;

    // Function definition: def name(params) ... end
    if (this.check('KEYWORD', 'def')) {
      return this.parseDefStatement();
    }

    // Conditionals: if ... elsif ... else ... end
    if (this.check('KEYWORD', 'if')) {
      return this.parseIfStatement();
    }

    // Loops: while ... end
    if (this.check('KEYWORD', 'while')) {
      return this.parseWhileStatement();
    }

    // Return statement: return [expr]
    if (this.check('KEYWORD', 'return')) {
      return this.parseReturnStatement();
    }

    // Break / Next
    if (this.check('KEYWORD', 'break') || this.check('KEYWORD', 'next') || this.check('KEYWORD', 'continue')) {
      const tok = this.advance();
      this.consumeStatementEnd();
      return new ASTNode(tok.value === 'break' ? 'BreakStatement' : 'ContinueStatement', {
        line: tok.line,
        col: tok.col,
        endLine: tok.line,
        endCol: tok.col + tok.length
      });
    }

    // Ruby Output built-in commands without parens: puts expr / print expr
    if (this.check('KEYWORD', 'puts') || this.check('KEYWORD', 'print')) {
      const commandTok = this.advance();
      // If immediately followed by '(', standard call expression
      if (this.check('PUNCTUATION', '(')) {
        const call = this.parseCallExpression(new ASTNode('Identifier', {
          name: commandTok.value,
          line: commandTok.line,
          col: commandTok.col
        }));
        this.consumeStatementEnd();
        return new ASTNode('ExpressionStatement', {
          expression: call,
          line: commandTok.line,
          col: commandTok.col,
          endLine: call.endLine,
          endCol: call.endCol
        });
      }

      // Space separated arguments: puts "hello", result
      const args = [];
      if (!this.isStatementSeparator(this.peek()) && !this.isAtEnd()) {
        do {
          args.push(this.parseExpression());
        } while (this.match('PUNCTUATION', ','));
      }
      this.consumeStatementEnd();

      const lastArg = args[args.length - 1];
      const callNode = new ASTNode('CallExpression', {
        callee: new ASTNode('Identifier', {
          name: commandTok.value,
          line: commandTok.line,
          col: commandTok.col
        }),
        arguments: args,
        line: commandTok.line,
        col: commandTok.col,
        endLine: lastArg ? lastArg.endLine : commandTok.line,
        endCol: lastArg ? lastArg.endCol : commandTok.col + commandTok.length
      });

      return new ASTNode('ExpressionStatement', {
        expression: callNode,
        line: commandTok.line,
        col: commandTok.col,
        endLine: callNode.endLine,
        endCol: callNode.endCol
      });
    }

    // Expression or Assignment statement
    const expr = this.parseExpression();
    this.consumeStatementEnd();

    return new ASTNode('ExpressionStatement', {
      expression: expr,
      line: expr.line,
      col: expr.col,
      endLine: expr.endLine,
      endCol: expr.endCol
    });
  }

  // -------------------------------------------------------------
  // Function: def name(params) ... end
  // -------------------------------------------------------------

  parseDefStatement() {
    const defTok = this.advance(); // consume 'def'

    if (!this.check('IDENTIFIER') && !this.check('KEYWORD')) {
      this.error(this.peek(), `Expected function name after 'def', found '${this.peek().value}'`, `Provide an identifier for the function name.`);
      return null;
    }
    const nameTok = this.advance();
    const name = nameTok.value;
    const params = [];

    // Optional parameter list: (a, b) or a, b
    if (this.match('PUNCTUATION', '(')) {
      if (!this.check('PUNCTUATION', ')')) {
        do {
          if (!this.check('IDENTIFIER')) {
            this.error(this.peek(), `Expected parameter identifier, found '${this.peek().value}'`);
            break;
          }
          const pTok = this.advance();
          params.push(new ASTNode('Parameter', {
            name: pTok.value,
            dataType: 'any',
            line: pTok.line,
            col: pTok.col,
            endLine: pTok.line,
            endCol: pTok.col + pTok.length
          }));
        } while (this.match('PUNCTUATION', ','));
      }
      this.consume('PUNCTUATION', ')', `Expected ')' after parameter list for def '${name}'`);
    } else if (this.check('IDENTIFIER') && !this.isStatementSeparator(this.peek())) {
      // Space separated params without parens: def add a, b
      do {
        if (!this.check('IDENTIFIER')) break;
        const pTok = this.advance();
        params.push(new ASTNode('Parameter', {
          name: pTok.value,
          dataType: 'any',
          line: pTok.line,
          col: pTok.col,
          endLine: pTok.line,
          endCol: pTok.col + pTok.length
        }));
      } while (this.match('PUNCTUATION', ','));
    }

    this.consumeStatementEnd();

    // Parse body statements until 'end'
    const bodyStmts = [];
    while (!this.check('KEYWORD', 'end') && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) bodyStmts.push(stmt);
      this.skipSeparators();
    }

    if (!this.match('KEYWORD', 'end')) {
      this.error(this.peek(), `Missing 'end' for function definition '${name}' starting at line ${defTok.line}`, `Add 'end' to close the function.`);
      this.quickFixes.push({
        title: `Add missing 'end' for function '${name}'`,
        description: `Append 'end' to terminate the function body.`,
        action: 'append_end',
        line: this.peek().line
      });
      return null;
    }

    const endTok = this.previous();
    const blockNode = new ASTNode('BlockStatement', {
      statements: bodyStmts,
      line: defTok.line,
      col: defTok.col,
      endLine: endTok.line,
      endCol: endTok.col + endTok.length
    });

    return new ASTNode('FunctionDeclaration', {
      name,
      returnType: 'any',
      params,
      body: blockNode,
      line: defTok.line,
      col: defTok.col,
      endLine: endTok.line,
      endCol: endTok.col + endTok.length
    });
  }

  // -------------------------------------------------------------
  // Conditional: if ... elsif ... else ... end
  // -------------------------------------------------------------

  parseIfStatement() {
    const ifTok = this.advance(); // consume 'if'
    const condition = this.parseExpression();
    this.consumeStatementEnd();

    // Parse then branch statements
    const thenStmts = [];
    while (!this.check('KEYWORD', 'elsif') && !this.check('KEYWORD', 'else') && !this.check('KEYWORD', 'end') && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) thenStmts.push(stmt);
      this.skipSeparators();
    }

    const thenBranch = new ASTNode('BlockStatement', {
      statements: thenStmts,
      line: ifTok.line,
      col: ifTok.col
    });

    const elsifBranches = [];
    while (this.match('KEYWORD', 'elsif')) {
      const elsifTok = this.previous();
      const elsifCond = this.parseExpression();
      this.consumeStatementEnd();

      const elsifStmts = [];
      while (!this.check('KEYWORD', 'elsif') && !this.check('KEYWORD', 'else') && !this.check('KEYWORD', 'end') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) elsifStmts.push(stmt);
        this.skipSeparators();
      }

      elsifBranches.push({
        condition: elsifCond,
        body: new ASTNode('BlockStatement', {
          statements: elsifStmts,
          line: elsifTok.line,
          col: elsifTok.col
        })
      });
    }

    let elseBranch = null;
    if (this.match('KEYWORD', 'else')) {
      const elseTok = this.previous();
      this.consumeStatementEnd();

      const elseStmts = [];
      while (!this.check('KEYWORD', 'end') && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) elseStmts.push(stmt);
        this.skipSeparators();
      }

      elseBranch = new ASTNode('BlockStatement', {
        statements: elseStmts,
        line: elseTok.line,
        col: elseTok.col
      });
    }

    if (!this.match('KEYWORD', 'end')) {
      this.error(this.peek(), `Missing 'end' for 'if' statement starting at line ${ifTok.line}`, `Add 'end' to close the if conditional.`);
      this.quickFixes.push({
        title: `Add missing 'end' for 'if' block`,
        description: `Append 'end' to terminate the conditional block.`,
        action: 'append_end',
        line: this.peek().line
      });
      return null;
    }

    const endTok = this.previous();

    return new ASTNode('IfStatement', {
      condition,
      thenBranch,
      elsifBranches,
      elseBranch,
      line: ifTok.line,
      col: ifTok.col,
      endLine: endTok.line,
      endCol: endTok.col + endTok.length
    });
  }

  // -------------------------------------------------------------
  // Loop: while ... end
  // -------------------------------------------------------------

  parseWhileStatement() {
    const whileTok = this.advance(); // consume 'while'
    const condition = this.parseExpression();
    this.consumeStatementEnd();

    const bodyStmts = [];
    while (!this.check('KEYWORD', 'end') && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) bodyStmts.push(stmt);
      this.skipSeparators();
    }

    if (!this.match('KEYWORD', 'end')) {
      this.error(this.peek(), `Missing 'end' for 'while' loop starting at line ${whileTok.line}`, `Add 'end' to close the while loop.`);
      this.quickFixes.push({
        title: `Add missing 'end' for 'while' loop`,
        description: `Append 'end' to terminate the loop block.`,
        action: 'append_end',
        line: this.peek().line
      });
      return null;
    }

    const endTok = this.previous();
    const bodyNode = new ASTNode('BlockStatement', {
      statements: bodyStmts,
      line: whileTok.line,
      col: whileTok.col,
      endLine: endTok.line,
      endCol: endTok.col + endTok.length
    });

    return new ASTNode('WhileStatement', {
      condition,
      body: bodyNode,
      line: whileTok.line,
      col: whileTok.col,
      endLine: endTok.line,
      endCol: endTok.col + endTok.length
    });
  }

  // -------------------------------------------------------------
  // Return Statement: return [expr]
  // -------------------------------------------------------------

  parseReturnStatement() {
    const retTok = this.advance();
    let arg = null;
    if (!this.isStatementSeparator(this.peek()) && !this.isAtEnd()) {
      arg = this.parseExpression();
    }
    this.consumeStatementEnd();

    return new ASTNode('ReturnStatement', {
      argument: arg,
      line: retTok.line,
      col: retTok.col,
      endLine: arg ? arg.endLine : retTok.line,
      endCol: arg ? arg.endCol : retTok.col + retTok.length
    });
  }

  // -------------------------------------------------------------
  // Expressions (Pratt Precedence Parsing)
  // -------------------------------------------------------------

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const expr = this.parseLogicalOr();

    // Assignment operators: =, +=, -=, *=, /=, %=, **=
    const assignOps = ['=', '+=', '-=', '*=', '/=', '%=', '**='];
    if (this.check('OPERATOR') && assignOps.includes(this.peek().value)) {
      const opTok = this.advance();
      const right = this.parseAssignment(); // Right-associative

      if (expr.type !== 'Identifier' && expr.type !== 'ArrayAccess') {
        this.error(opTok, `Invalid assignment target. Left-hand side must be a variable or array element.`);
        return expr;
      }

      return new ASTNode('AssignmentExpression', {
        operator: opTok.value,
        left: expr,
        right,
        line: expr.line,
        col: expr.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }

    return expr;
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.match('OPERATOR', '||')) {
      const opTok = this.previous();
      const right = this.parseLogicalAnd();
      left = new ASTNode('LogicalExpression', {
        operator: '||',
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseEquality();
    while (this.match('OPERATOR', '&&')) {
      const opTok = this.previous();
      const right = this.parseEquality();
      left = new ASTNode('LogicalExpression', {
        operator: '&&',
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (this.match('OPERATOR', '==') || this.match('OPERATOR', '!=')) {
      const opTok = this.previous();
      const right = this.parseComparison();
      left = new ASTNode('BinaryExpression', {
        operator: opTok.value,
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (this.match('OPERATOR', '<') || this.match('OPERATOR', '<=') ||
           this.match('OPERATOR', '>') || this.match('OPERATOR', '>=')) {
      const opTok = this.previous();
      const right = this.parseAdditive();
      left = new ASTNode('BinaryExpression', {
        operator: opTok.value,
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.match('OPERATOR', '+') || this.match('OPERATOR', '-')) {
      const opTok = this.previous();
      const right = this.parseMultiplicative();
      left = new ASTNode('BinaryExpression', {
        operator: opTok.value,
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseExponentiation();
    while (this.match('OPERATOR', '*') || this.match('OPERATOR', '/') || this.match('OPERATOR', '%')) {
      const opTok = this.previous();
      const right = this.parseExponentiation();
      left = new ASTNode('BinaryExpression', {
        operator: opTok.value,
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  // Ruby Exponentiation: ** (Right-associative)
  parseExponentiation() {
    let left = this.parseUnary();
    if (this.match('OPERATOR', '**')) {
      const opTok = this.previous();
      const right = this.parseExponentiation(); // Right-associative!
      return new ASTNode('BinaryExpression', {
        operator: '**',
        left,
        right,
        line: left.line,
        col: left.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }
    return left;
  }

  parseUnary() {
    if (this.match('OPERATOR', '!') || this.match('OPERATOR', '-')) {
      const opTok = this.previous();
      const argument = this.parseUnary();
      return new ASTNode('UnaryExpression', {
        operator: opTok.value,
        argument,
        prefix: true,
        line: opTok.line,
        col: opTok.col,
        endLine: argument.endLine,
        endCol: argument.endCol
      });
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();

    // Integer or Float literal
    if (this.match('NUMBER') || this.match('FLOAT')) {
      const prev = this.previous();
      return new ASTNode('Literal', {
        value: prev.value,
        raw: String(prev.value),
        dataType: prev.type === 'FLOAT' ? 'float' : 'int',
        line: prev.line,
        col: prev.col,
        endLine: prev.line,
        endCol: prev.col + prev.length
      });
    }

    // String literal
    if (this.match('STRING')) {
      const prev = this.previous();
      return new ASTNode('Literal', {
        value: prev.value,
        raw: `"${prev.value}"`,
        dataType: 'string',
        line: prev.line,
        col: prev.col,
        endLine: prev.line,
        endCol: prev.col + prev.length
      });
    }

    // Boolean literal (true / false)
    if (this.match('BOOLEAN')) {
      const prev = this.previous();
      return new ASTNode('Literal', {
        value: prev.value,
        raw: String(prev.value),
        dataType: 'bool',
        line: prev.line,
        col: prev.col,
        endLine: prev.line,
        endCol: prev.col + prev.length
      });
    }

    // Nil literal
    if (this.match('NIL') || this.match('KEYWORD', 'nil')) {
      const prev = this.previous();
      return new ASTNode('Literal', {
        value: null,
        raw: 'nil',
        dataType: 'nil',
        line: prev.line,
        col: prev.col,
        endLine: prev.line,
        endCol: prev.col + prev.length
      });
    }

    // Array literal: [1, 2, 3]
    if (this.match('PUNCTUATION', '[')) {
      const openTok = this.previous();
      const elements = [];
      if (!this.check('PUNCTUATION', ']')) {
        do {
          this.skipSeparators();
          elements.push(this.parseExpression());
          this.skipSeparators();
        } while (this.match('PUNCTUATION', ','));
      }
      this.consume('PUNCTUATION', ']', "Expected ']' at end of array literal");
      const closeTok = this.previous();
      return new ASTNode('ArrayLiteral', {
        elements,
        dataType: 'array',
        line: openTok.line,
        col: openTok.col,
        endLine: closeTok.line,
        endCol: closeTok.col + closeTok.length
      });
    }

    // Grouping expression: (expr)
    if (this.match('PUNCTUATION', '(')) {
      const openTok = this.previous();
      const expr = this.parseExpression();
      this.consume('PUNCTUATION', ')', "Expected ')' after grouped expression");
      const closeTok = this.previous();
      return new ASTNode('GroupingExpression', {
        expression: expr,
        line: openTok.line,
        col: openTok.col,
        endLine: closeTok.line,
        endCol: closeTok.col + closeTok.length
      });
    }

    // gets or gets.to_i / gets.to_f
    if (this.match('KEYWORD', 'gets') || this.match('IDENTIFIER', 'gets')) {
      const getsTok = this.previous();
      let callNode = new ASTNode('CallExpression', {
        callee: new ASTNode('Identifier', { name: 'gets', line: getsTok.line, col: getsTok.col }),
        arguments: [],
        line: getsTok.line,
        col: getsTok.col,
        endLine: getsTok.line,
        endCol: getsTok.col + getsTok.length
      });

      // Handle method chaining: gets.to_i or gets.to_f
      if (this.match('PUNCTUATION', '.')) {
        if (this.check('IDENTIFIER')) {
          const methodTok = this.advance();
          callNode = new ASTNode('CallExpression', {
            callee: new ASTNode('Identifier', { name: methodTok.value, line: methodTok.line, col: methodTok.col }),
            arguments: [callNode],
            line: getsTok.line,
            col: getsTok.col,
            endLine: methodTok.line,
            endCol: methodTok.col + methodTok.length
          });
        }
      }
      return callNode;
    }

    // Identifier or Function call
    if (this.match('IDENTIFIER') || this.match('KEYWORD', 'print') || this.match('KEYWORD', 'puts') || this.match('KEYWORD', 'input')) {
      const idTok = this.previous();
      const idNode = new ASTNode('Identifier', {
        name: idTok.value,
        line: idTok.line,
        col: idTok.col,
        endLine: idTok.line,
        endCol: idTok.col + idTok.length
      });

      // Function call with parentheses: id(...)
      if (this.match('PUNCTUATION', '(')) {
        return this.parseCallExpression(idNode);
      }

      // Array indexing: id[index]
      if (this.match('PUNCTUATION', '[')) {
        const indexExpr = this.parseExpression();
        this.consume('PUNCTUATION', ']', "Expected ']' after array index");
        const closeTok = this.previous();
        return new ASTNode('ArrayAccess', {
          array: idNode,
          index: indexExpr,
          line: idNode.line,
          col: idNode.col,
          endLine: closeTok.line,
          endCol: closeTok.col + closeTok.length
        });
      }

      // Method call: id.method
      if (this.match('PUNCTUATION', '.')) {
        if (this.check('IDENTIFIER')) {
          const methodTok = this.advance();
          return new ASTNode('CallExpression', {
            callee: new ASTNode('Identifier', { name: methodTok.value, line: methodTok.line, col: methodTok.col }),
            arguments: [idNode],
            line: idNode.line,
            col: idNode.col,
            endLine: methodTok.line,
            endCol: methodTok.col + methodTok.length
          });
        }
      }

      return idNode;
    }

    // Syntax error on unexpected token
    const errTok = this.peek();
    this.error(errTok, `Unexpected token in expression: '${errTok.value}' (type: ${errTok.type})`, `Check for balanced parentheses, valid operators, or typos.`);
    this.advance();
    return new ASTNode('ErrorNode', {
      line: errTok.line,
      col: errTok.col,
      endLine: errTok.line,
      endCol: errTok.col + errTok.length
    });
  }

  parseCallExpression(callee) {
    const args = [];
    if (!this.check('PUNCTUATION', ')')) {
      do {
        args.push(this.parseExpression());
      } while (this.match('PUNCTUATION', ','));
    }
    this.consume('PUNCTUATION', ')', `Expected ')' after argument list for '${callee.name}'`);
    const closeTok = this.previous();

    return new ASTNode('CallExpression', {
      callee,
      arguments: args,
      line: callee.line,
      col: callee.col,
      endLine: closeTok.line,
      endCol: closeTok.col + closeTok.length
    });
  }

  // -------------------------------------------------------------
  // Helpers & Error Synchronization
  // -------------------------------------------------------------

  peek() {
    return this.tokens[this.current] || { type: 'EOF', value: '<EOF>', line: 0, col: 0, length: 0 };
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  isAtEnd() {
    return this.peek().type === 'EOF';
  }

  check(type, val = null) {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    if (tok.type !== type) return false;
    if (val !== null && tok.value !== val) return false;
    return true;
  }

  match(type, val = null) {
    if (this.check(type, val)) {
      this.advance();
      return true;
    }
    return false;
  }

  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  consume(type, val, msg, suggestion = '') {
    if (this.check(type, val)) {
      return this.advance();
    }
    this.error(this.peek(), msg, suggestion);
    return null;
  }

  isStatementSeparator(tok) {
    if (!tok) return true;
    return tok.type === 'NEWLINE' || (tok.type === 'PUNCTUATION' && tok.value === ';') || tok.type === 'EOF';
  }

  skipSeparators() {
    while (!this.isAtEnd() && (this.peek().type === 'NEWLINE' || (this.peek().type === 'PUNCTUATION' && this.peek().value === ';'))) {
      this.advance();
    }
  }

  consumeStatementEnd() {
    if (this.isAtEnd()) return;
    if (this.peek().type === 'NEWLINE' || (this.peek().type === 'PUNCTUATION' && this.peek().value === ';')) {
      this.advance();
      this.skipSeparators();
      return;
    }
    // If not explicitly separated, check if followed by block closer or EOF
    const nextVal = this.peek().value;
    if (nextVal === 'end' || nextVal === 'elsif' || nextVal === 'else' || this.isAtEnd()) {
      return;
    }
    // Emit warning / error for missing newline or semicolon
    this.error(this.peek(), `Expected newline or ';' after statement, found '${this.peek().value}'`, `Separate statements with newlines or semicolons.`);
  }

  error(token, message, suggestion = '') {
    const err = {
      line: token.line,
      col: token.col,
      length: token.length || 1,
      message,
      suggestion
    };
    this.errors.push(err);
  }

  synchronize() {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.previous().type === 'NEWLINE' || (this.previous().type === 'PUNCTUATION' && this.previous().value === ';')) {
        return;
      }
      switch (this.peek().value) {
        case 'def':
        case 'if':
        case 'while':
        case 'return':
        case 'puts':
        case 'print':
        case 'end':
          return;
      }
      this.advance();
    }
  }

  // -------------------------------------------------------------
  // Compact Text Tree Generator (for Text Tree tab view)
  // -------------------------------------------------------------

  static toTextTree(node, prefix = '', isLast = true) {
    if (!node) return '';

    let label = node.type;
    if (node.name) label += `: ${node.name}`;
    if (node.value !== undefined) label += ` (${node.value})`;
    if (node.operator) label += ` [${node.operator}]`;
    if (node.dataType) label += ` <${node.dataType}>`;

    let res = prefix + (isLast ? '└── ' : '├── ') + label + '\n';
    const children = typeof node.getChildren === 'function' ? node.getChildren() : (node.children || []);
    const newPrefix = prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < children.length; i++) {
      res += Parser.toTextTree(children[i], newPrefix, i === children.length - 1);
    }
    return res;
  }

  toTextTree(ast = null, prefix = '', isLast = true) {
    const node = ast || this.tokens;
    return Parser.toTextTree(node, prefix, isLast);
  }

  // -------------------------------------------------------------
  // SVG Tree Coordinates Layout Generator (Reingold-Tilford Tidy Tree)
  // -------------------------------------------------------------

  static computeLayout(rootNode, nodeWidth = 140, nodeHeight = 38, hGap = 24, vGap = 60) {
    if (!rootNode) return { width: 400, height: 300 };

    // Post-order pass: compute subtree widths
    function calcWidth(node) {
      if (!node) return 0;
      const children = node.getChildren();
      if (!children || children.length === 0 || node.collapsed) {
        node.subtreeWidth = nodeWidth;
        return node.subtreeWidth;
      }
      let totalW = 0;
      for (const ch of children) {
        totalW += calcWidth(ch);
      }
      totalW += (children.length - 1) * hGap;
      node.subtreeWidth = Math.max(nodeWidth, totalW);
      return node.subtreeWidth;
    }

    // Pre-order pass: assign (x, y) coordinates
    let maxY = 0;
    let minX = Infinity;
    let maxX = -Infinity;

    function assignPos(node, currentX, currentY) {
      if (!node) return;
      node.x = currentX + node.subtreeWidth / 2;
      node.y = currentY;
      maxY = Math.max(maxY, node.y + nodeHeight);
      minX = Math.min(minX, node.x - nodeWidth / 2);
      maxX = Math.max(maxX, node.x + nodeWidth / 2);

      const children = node.getChildren();
      if (!children || children.length === 0 || node.collapsed) return;

      let childLeft = currentX;
      for (const ch of children) {
        assignPos(ch, childLeft, currentY + nodeHeight + vGap);
        childLeft += ch.subtreeWidth + hGap;
      }
    }

    calcWidth(rootNode);
    assignPos(rootNode, 40, 40);

    return {
      width: Math.max(600, maxX + 80),
      height: Math.max(450, maxY + 80),
      minX,
      maxX,
      maxY
    };
  }
}

// Export for Node.js test suites
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Parser, ASTNode };
}
