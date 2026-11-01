/**
 * CompilerLens - Syntax Analyzer (parser.js)
 * Phase 2: Parses token stream into a hierarchical Abstract Syntax Tree (AST),
 * provides error recovery and synchronization, generates compact text tree representation,
 * and computes tree layout for interactive SVG visualization.
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
    // Coordinates for SVG layout
    this.x = 0;
    this.y = 0;
    this.subtreeWidth = 0;
  }

  // Helper to ensure children array is always populated and updated
  updateChildren() {
    const list = [];
    switch (this.type) {
      case 'Program':
        return this.declarations || [];
      case 'FunctionDeclaration':
        if (this.params) list.push(...this.params);
        if (this.body) list.push(this.body);
        return list;
      case 'VariableDeclaration':
        return this.declarations || [];
      case 'VariableDeclarator':
        if (this.init) list.push(this.init);
        return list;
      case 'ArrayDeclaration':
        if (this.sizeExpr) list.push(this.sizeExpr);
        if (this.elements) list.push(...this.elements);
        return list;
      case 'BlockStatement':
        return this.statements || [];
      case 'ExpressionStatement':
        return this.expression ? [this.expression] : [];
      case 'IfStatement':
        if (this.condition) list.push(this.condition);
        if (this.thenBranch) list.push(this.thenBranch);
        if (this.elseBranch) list.push(this.elseBranch);
        return list;
      case 'WhileStatement':
      case 'DoWhileStatement':
        if (this.condition) list.push(this.condition);
        if (this.body) list.push(this.body);
        return list;
      case 'ForStatement':
        if (this.init) list.push(this.init);
        if (this.condition) list.push(this.condition);
        if (this.step) list.push(this.step);
        if (this.body) list.push(this.body);
        return list;
      case 'ReturnStatement':
        return this.argument ? [this.argument] : [];
      case 'BinaryExpression':
      case 'LogicalExpression':
      case 'AssignmentExpression':
        return [this.left, this.right].filter(Boolean);
      case 'UnaryExpression':
      case 'UpdateExpression':
        return this.argument ? [this.argument] : [];
      case 'CallExpression':
        return [this.callee, ...(this.arguments || [])].filter(Boolean);
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
    astNodeIdCounter = 0;
  }

  parse(tokens) {
    if (tokens !== undefined) {
      this.tokens = tokens;
    }
    this.current = 0;
    this.errors = [];
    astNodeIdCounter = 0;

    const programNode = new ASTNode('Program', {
      declarations: [],
      line: 1,
      col: 1
    });

    while (!this.isAtEnd()) {
      try {
        const decl = this.parseTopLevelDeclaration();
        if (decl) {
          programNode.declarations.push(decl);
        }
      } catch (err) {
        // If an uncaught parse exception was thrown, recover to next declaration
        this.synchronize();
      }
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
      errors: this.errors
    };
  }

  // -------------------------------------------------------------
  // Top-Level Parsing: Functions or Global Variables
  // -------------------------------------------------------------

  parseTopLevelDeclaration() {
    // Check if it's a type (int, float, char, bool, void)
    if (this.isTypeKeyword(this.peek())) {
      const typeToken = this.advance();
      const typeName = typeToken.value;

      // Expect an identifier name
      if (!this.check('IDENTIFIER')) {
        this.error(this.peek(), `Expected identifier after type '${typeName}', found '${this.peek().value}'`, `Provide a name for the variable or function.`);
        this.synchronize();
        return null;
      }

      const idToken = this.advance();
      const idName = idToken.value;

      // Function definition: type id '(' ...
      if (this.match('PUNCTUATION', '(')) {
        return this.parseFunctionDeclaration(typeName, idName, typeToken, idToken);
      }

      // Array declaration: type id '[' size ']' ...
      if (this.match('PUNCTUATION', '[')) {
        return this.parseArrayDeclaration(typeName, idName, typeToken, idToken);
      }

      // Normal variable declaration: type id = expr, id2 ... ;
      return this.parseVariableDeclarationRest(typeName, idName, typeToken, idToken);
    }

    // Unexpected top-level token
    const token = this.peek();
    this.error(token, `Expected a function or variable declaration, found '${token.value}'`, `Start declarations with a type such as 'int', 'float', 'void', or 'bool'.`);
    this.advance();
    this.synchronize();
    return null;
  }

  parseFunctionDeclaration(returnType, name, typeToken, idToken) {
    const params = [];
    if (!this.check('PUNCTUATION', ')')) {
      do {
        if (!this.isTypeKeyword(this.peek())) {
          this.error(this.peek(), `Expected parameter type, found '${this.peek().value}'`, `Specify parameter type like 'int n'.`);
          break;
        }
        const pTypeToken = this.advance();
        let isArray = false;
        if (!this.check('IDENTIFIER')) {
          this.error(this.peek(), `Expected parameter name after '${pTypeToken.value}'`, `Provide an identifier name for the parameter.`);
          break;
        }
        const pIdToken = this.advance();

        // Check if array param: int arr[]
        if (this.match('PUNCTUATION', '[')) {
          this.consume('PUNCTUATION', ']', 'Expected "]" for array parameter');
          isArray = true;
        }

        params.push(new ASTNode('Parameter', {
          name: pIdToken.value,
          dataType: pTypeToken.value,
          isArray,
          line: pTypeToken.line,
          col: pTypeToken.col,
          endLine: pIdToken.line,
          endCol: pIdToken.col + pIdToken.length
        }));
      } while (this.match('PUNCTUATION', ','));
    }

    this.consume('PUNCTUATION', ')', `Expected ')' after parameter list for function '${name}'`, `Add closing ')' to end the parameter list.`);

    // Expect function body block
    if (!this.check('PUNCTUATION', '{')) {
      this.error(this.peek(), `Expected '{' for function body of '${name}'`, `Add '{' to start the function block.`);
      return null;
    }

    const body = this.parseBlockStatement();

    return new ASTNode('FunctionDeclaration', {
      name,
      returnType,
      params,
      body,
      line: typeToken.line,
      col: typeToken.col,
      endLine: body ? body.endLine : idToken.line,
      endCol: body ? body.endCol : idToken.col
    });
  }

  parseArrayDeclaration(dataType, name, typeToken, idToken) {
    let sizeExpr = null;
    let size = null;
    if (!this.check('PUNCTUATION', ']')) {
      sizeExpr = this.parseExpression();
      if (sizeExpr && sizeExpr.type === 'Literal' && typeof sizeExpr.value === 'number') {
        size = sizeExpr.value;
      }
    }
    this.consume('PUNCTUATION', ']', `Expected ']' after array size`, `Add ']' to close array dimensions.`);

    let elements = [];
    if (this.match('OPERATOR', '=')) {
      if (this.match('PUNCTUATION', '{')) {
        if (!this.check('PUNCTUATION', '}')) {
          do {
            elements.push(this.parseExpression());
          } while (this.match('PUNCTUATION', ','));
        }
        this.consume('PUNCTUATION', '}', `Expected '}' at end of array initializer`);
      } else {
        this.error(this.peek(), `Expected '{' for array initializer list`, `Use '{ val1, val2, ... }' to initialize an array.`);
      }
    }

    this.consume('PUNCTUATION', ';', `Missing ';' after array declaration for '${name}'`, `Add ';' at the end of the declaration.`);

    return new ASTNode('ArrayDeclaration', {
      name,
      dataType,
      size,
      sizeExpr,
      elements,
      line: typeToken.line,
      col: typeToken.col,
      endLine: this.previous().line,
      endCol: this.previous().col + this.previous().length
    });
  }

  parseVariableDeclarationRest(dataType, firstName, typeToken, firstIdToken) {
    const declarators = [];

    // First declarator
    let firstInit = null;
    if (this.match('OPERATOR', '=')) {
      firstInit = this.parseExpression();
    }
    declarators.push(new ASTNode('VariableDeclarator', {
      id: new ASTNode('Identifier', { name: firstName, line: firstIdToken.line, col: firstIdToken.col }),
      init: firstInit,
      line: firstIdToken.line,
      col: firstIdToken.col,
      endLine: firstInit ? firstInit.endLine : firstIdToken.line,
      endCol: firstInit ? firstInit.endCol : firstIdToken.col + firstIdToken.length
    }));

    // Subsequent declarators separated by comma: int a = 5, b = 10;
    while (this.match('PUNCTUATION', ',')) {
      if (!this.check('IDENTIFIER')) {
        this.error(this.peek(), `Expected identifier after ',' in variable declaration`, `Provide a variable name.`);
        break;
      }
      const nextId = this.advance();
      let nextInit = null;
      if (this.match('OPERATOR', '=')) {
        nextInit = this.parseExpression();
      }
      declarators.push(new ASTNode('VariableDeclarator', {
        id: new ASTNode('Identifier', { name: nextId.value, line: nextId.line, col: nextId.col }),
        init: nextInit,
        line: nextId.line,
        col: nextId.col,
        endLine: nextInit ? nextInit.endLine : nextId.line,
        endCol: nextInit ? nextInit.endCol : nextId.col + nextId.length
      }));
    }

    this.consume('PUNCTUATION', ';', `Missing ';' at end of variable declaration`, `Insert ';' at the end of the line.`);

    return new ASTNode('VariableDeclaration', {
      dataType,
      declarations: declarators,
      line: typeToken.line,
      col: typeToken.col,
      endLine: this.previous().line,
      endCol: this.previous().col + this.previous().length
    });
  }

  // -------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------

  parseStatement() {
    const token = this.peek();

    // Block Statement: { ... }
    if (token.type === 'PUNCTUATION' && token.value === '{') {
      return this.parseBlockStatement();
    }

    // Local Variable or Array Declaration
    if (this.isTypeKeyword(token)) {
      const typeToken = this.advance();
      if (!this.check('IDENTIFIER')) {
        this.error(this.peek(), `Expected identifier after '${typeToken.value}'`, `Provide variable name.`);
        this.synchronize();
        return null;
      }
      const idToken = this.advance();
      if (this.match('PUNCTUATION', '[')) {
        return this.parseArrayDeclaration(typeToken.value, idToken.value, typeToken, idToken);
      }
      return this.parseVariableDeclarationRest(typeToken.value, idToken.value, typeToken, idToken);
    }

    // If Statement: if (cond) stmt [else stmt]
    if (this.match('KEYWORD', 'if')) {
      return this.parseIfStatement(this.previous());
    }

    // While Statement: while (cond) stmt
    if (this.match('KEYWORD', 'while')) {
      return this.parseWhileStatement(this.previous());
    }

    // Do-While Statement: do stmt while (cond);
    if (this.match('KEYWORD', 'do')) {
      return this.parseDoWhileStatement(this.previous());
    }

    // For Statement: for (init; cond; step) stmt
    if (this.match('KEYWORD', 'for')) {
      return this.parseForStatement(this.previous());
    }

    // Return Statement: return [expr];
    if (this.match('KEYWORD', 'return')) {
      return this.parseReturnStatement(this.previous());
    }

    // Break Statement: break;
    if (this.match('KEYWORD', 'break')) {
      const start = this.previous();
      this.consume('PUNCTUATION', ';', `Missing ';' after break`, `Add ';' after break.`);
      return new ASTNode('BreakStatement', {
        line: start.line,
        col: start.col,
        endLine: this.previous().line,
        endCol: this.previous().col + this.previous().length
      });
    }

    // Continue Statement: continue;
    if (this.match('KEYWORD', 'continue')) {
      const start = this.previous();
      this.consume('PUNCTUATION', ';', `Missing ';' after continue`, `Add ';' after continue.`);
      return new ASTNode('ContinueStatement', {
        line: start.line,
        col: start.col,
        endLine: this.previous().line,
        endCol: this.previous().col + this.previous().length
      });
    }

    // Empty statement: ;
    if (this.match('PUNCTUATION', ';')) {
      return new ASTNode('EmptyStatement', {
        line: this.previous().line,
        col: this.previous().col
      });
    }

    // Expression Statement: expr;
    return this.parseExpressionStatement();
  }

  parseBlockStatement() {
    const openBrace = this.consume('PUNCTUATION', '{', `Expected '{' to begin block`);
    const statements = [];

    while (!this.check('PUNCTUATION', '}') && !this.isAtEnd()) {
      try {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      } catch (err) {
        this.synchronize();
      }
    }

    const closeBrace = this.consume('PUNCTUATION', '}', `Expected '}' to close block statement`, `Add '}' to match the opening brace on line ${openBrace ? openBrace.line : 'unknown'}.`);

    return new ASTNode('BlockStatement', {
      statements,
      line: openBrace ? openBrace.line : this.peek().line,
      col: openBrace ? openBrace.col : this.peek().col,
      endLine: closeBrace ? closeBrace.line : this.peek().line,
      endCol: closeBrace ? closeBrace.col + closeBrace.length : this.peek().col
    });
  }

  parseIfStatement(ifToken) {
    this.consume('PUNCTUATION', '(', `Expected '(' after 'if'`, `Add '(' before the condition.`);
    const condition = this.parseExpression();
    this.consume('PUNCTUATION', ')', `Expected ')' after if condition`, `Add ')' after the condition.`);

    const thenBranch = this.parseStatement();
    let elseBranch = null;

    if (this.match('KEYWORD', 'else')) {
      elseBranch = this.parseStatement();
    }

    return new ASTNode('IfStatement', {
      condition,
      thenBranch,
      elseBranch,
      line: ifToken.line,
      col: ifToken.col,
      endLine: (elseBranch || thenBranch).endLine || ifToken.line,
      endCol: (elseBranch || thenBranch).endCol || ifToken.col
    });
  }

  parseWhileStatement(whileToken) {
    this.consume('PUNCTUATION', '(', `Expected '(' after 'while'`, `Add '(' before the condition.`);
    const condition = this.parseExpression();
    this.consume('PUNCTUATION', ')', `Expected ')' after while condition`, `Add ')' after the condition.`);

    const body = this.parseStatement();

    return new ASTNode('WhileStatement', {
      condition,
      body,
      line: whileToken.line,
      col: whileToken.col,
      endLine: body ? body.endLine : whileToken.line,
      endCol: body ? body.endCol : whileToken.col
    });
  }

  parseDoWhileStatement(doToken) {
    const body = this.parseStatement();
    this.consume('KEYWORD', 'while', `Expected 'while' after do block`, `Add 'while (condition);' after the loop body.`);
    this.consume('PUNCTUATION', '(', `Expected '(' after 'while' in do-while loop`);
    const condition = this.parseExpression();
    this.consume('PUNCTUATION', ')', `Expected ')' after do-while condition`);
    this.consume('PUNCTUATION', ';', `Missing ';' after do-while statement`, `Add ';' after 'while (...)'.`);

    return new ASTNode('DoWhileStatement', {
      body,
      condition,
      line: doToken.line,
      col: doToken.col,
      endLine: this.previous().line,
      endCol: this.previous().col + this.previous().length
    });
  }

  parseForStatement(forToken) {
    this.consume('PUNCTUATION', '(', `Expected '(' after 'for'`, `Add '(' before for loop components.`);

    // Init: variable declaration, expression, or empty
    let init = null;
    if (this.isTypeKeyword(this.peek())) {
      const typeToken = this.advance();
      const idToken = this.consume('IDENTIFIER', null, `Expected identifier in for-loop variable declaration`);
      init = this.parseVariableDeclarationRest(typeToken.value, idToken.value, typeToken, idToken);
    } else if (!this.check('PUNCTUATION', ';')) {
      init = this.parseExpression();
      this.consume('PUNCTUATION', ';', `Expected ';' after for loop initialization`);
    } else {
      this.consume('PUNCTUATION', ';', `Expected ';' after for loop initialization`);
    }

    // Condition
    let condition = null;
    if (!this.check('PUNCTUATION', ';')) {
      condition = this.parseExpression();
    }
    this.consume('PUNCTUATION', ';', `Expected ';' after for loop condition`, `Add ';' between condition and step.`);

    // Step
    let step = null;
    if (!this.check('PUNCTUATION', ')')) {
      step = this.parseExpression();
    }
    this.consume('PUNCTUATION', ')', `Expected ')' after for loop clauses`, `Add ')' before loop body.`);

    const body = this.parseStatement();

    return new ASTNode('ForStatement', {
      init,
      condition,
      step,
      body,
      line: forToken.line,
      col: forToken.col,
      endLine: body ? body.endLine : forToken.line,
      endCol: body ? body.endCol : forToken.col
    });
  }

  parseReturnStatement(returnToken) {
    let argument = null;
    if (!this.check('PUNCTUATION', ';')) {
      argument = this.parseExpression();
    }
    this.consume('PUNCTUATION', ';', `Missing ';' after return statement`, `Add ';' at the end of the return statement.`);

    return new ASTNode('ReturnStatement', {
      argument,
      line: returnToken.line,
      col: returnToken.col,
      endLine: this.previous().line,
      endCol: this.previous().col + this.previous().length
    });
  }

  parseExpressionStatement() {
    const expr = this.parseExpression();
    this.consume('PUNCTUATION', ';', `Missing ';' after expression`, `Add ';' at the end of statement.`);

    return new ASTNode('ExpressionStatement', {
      expression: expr,
      line: expr ? expr.line : this.peek().line,
      col: expr ? expr.col : this.peek().col,
      endLine: this.previous().line,
      endCol: this.previous().col + this.previous().length
    });
  }

  // -------------------------------------------------------------
  // Expression Parsing with Precedence Climbing
  // -------------------------------------------------------------

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const expr = this.parseLogicalOr();

    const assignOps = ['=', '+=', '-=', '*=', '/=', '%='];
    if (this.check('OPERATOR') && assignOps.includes(this.peek().value)) {
      const opToken = this.advance();
      const right = this.parseAssignment();

      if (expr.type === 'Identifier' || expr.type === 'ArrayAccess') {
        return new ASTNode('AssignmentExpression', {
          operator: opToken.value,
          left: expr,
          right,
          line: expr.line,
          col: expr.col,
          endLine: right ? right.endLine : opToken.line,
          endCol: right ? right.endCol : opToken.col
        });
      }

      this.error(opToken, `Invalid assignment target. Left-hand side must be a variable or array element.`, `Assign to a variable or array element.`);
    }

    return expr;
  }

  parseLogicalOr() {
    let expr = this.parseLogicalAnd();

    while (this.match('OPERATOR', '||')) {
      const op = this.previous();
      const right = this.parseLogicalAnd();
      expr = new ASTNode('LogicalExpression', {
        operator: '||',
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

  parseLogicalAnd() {
    let expr = this.parseEquality();

    while (this.match('OPERATOR', '&&')) {
      const op = this.previous();
      const right = this.parseEquality();
      expr = new ASTNode('LogicalExpression', {
        operator: '&&',
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

  parseEquality() {
    let expr = this.parseRelational();

    while (this.check('OPERATOR') && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.advance();
      const right = this.parseRelational();
      expr = new ASTNode('BinaryExpression', {
        operator: op.value,
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

  parseRelational() {
    let expr = this.parseAdditive();

    const relOps = ['<', '<=', '>', '>='];
    while (this.check('OPERATOR') && relOps.includes(this.peek().value)) {
      const op = this.advance();
      const right = this.parseAdditive();
      expr = new ASTNode('BinaryExpression', {
        operator: op.value,
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

  parseAdditive() {
    let expr = this.parseMultiplicative();

    while (this.check('OPERATOR') && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance();
      const right = this.parseMultiplicative();
      expr = new ASTNode('BinaryExpression', {
        operator: op.value,
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

  parseMultiplicative() {
    let expr = this.parseUnary();

    const multOps = ['*', '/', '%'];
    while (this.check('OPERATOR') && multOps.includes(this.peek().value)) {
      const op = this.advance();
      const right = this.parseUnary();
      expr = new ASTNode('BinaryExpression', {
        operator: op.value,
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

  parseUnary() {
    // Unary prefix: !, -, +, ++, --
    const prefixOps = ['!', '-', '+', '++', '--'];
    if (this.check('OPERATOR') && prefixOps.includes(this.peek().value)) {
      const op = this.advance();
      const right = this.parseUnary();
      if (op.value === '++' || op.value === '--') {
        return new ASTNode('UpdateExpression', {
          operator: op.value,
          prefix: true,
          argument: right,
          line: op.line,
          col: op.col,
          endLine: right.endLine,
          endCol: right.endCol
        });
      }
      return new ASTNode('UnaryExpression', {
        operator: op.value,
        argument: right,
        line: op.line,
        col: op.col,
        endLine: right.endLine,
        endCol: right.endCol
      });
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    let expr = this.parsePrimary();

    while (true) {
      // Function Call: expr(args)
      if (this.match('PUNCTUATION', '(')) {
        const args = [];
        if (!this.check('PUNCTUATION', ')')) {
          do {
            args.push(this.parseExpression());
          } while (this.match('PUNCTUATION', ','));
        }
        const closeParen = this.consume('PUNCTUATION', ')', `Expected ')' after argument list`);
        expr = new ASTNode('CallExpression', {
          callee: expr,
          arguments: args,
          line: expr.line,
          col: expr.col,
          endLine: closeParen ? closeParen.line : expr.line,
          endCol: closeParen ? closeParen.col + closeParen.length : expr.col
        });
        continue;
      }

      // Array Access: expr[index]
      if (this.match('PUNCTUATION', '[')) {
        const indexExpr = this.parseExpression();
        const closeBracket = this.consume('PUNCTUATION', ']', `Expected ']' after array index`);
        expr = new ASTNode('ArrayAccess', {
          array: expr,
          index: indexExpr,
          line: expr.line,
          col: expr.col,
          endLine: closeBracket ? closeBracket.line : expr.line,
          endCol: closeBracket ? closeBracket.col + closeBracket.length : expr.col
        });
        continue;
      }

      // Postfix ++ / --
      if (this.check('OPERATOR') && (this.peek().value === '++' || this.peek().value === '--')) {
        const op = this.advance();
        expr = new ASTNode('UpdateExpression', {
          operator: op.value,
          prefix: false,
          argument: expr,
          line: expr.line,
          col: expr.col,
          endLine: op.line,
          endCol: op.col + op.length
        });
        continue;
      }

      break;
    }

    return expr;
  }

  parsePrimary() {
    const token = this.peek();

    // Literal Numbers (Integer, Float)
    if (token.type === 'NUMBER' || token.type === 'FLOAT') {
      this.advance();
      return new ASTNode('Literal', {
        value: token.value,
        raw: token.raw,
        dataType: token.type === 'FLOAT' ? 'float' : 'int',
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Literal String
    if (token.type === 'STRING') {
      this.advance();
      return new ASTNode('Literal', {
        value: token.value,
        raw: token.raw,
        dataType: 'string',
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Literal Char
    if (token.type === 'CHAR') {
      this.advance();
      return new ASTNode('Literal', {
        value: token.value,
        raw: token.raw,
        dataType: 'char',
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Literal Boolean
    if (token.type === 'BOOLEAN') {
      this.advance();
      return new ASTNode('Literal', {
        value: token.value,
        raw: token.raw,
        dataType: 'bool',
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Built-in I/O calls treated as identifiers for call parsing (e.g. print, printf, scanf, input)
    if (token.type === 'KEYWORD' && (token.value === 'print' || token.value === 'printf' || token.value === 'scanf' || token.value === 'input')) {
      this.advance();
      return new ASTNode('Identifier', {
        name: token.value,
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Identifiers
    if (token.type === 'IDENTIFIER') {
      this.advance();
      return new ASTNode('Identifier', {
        name: token.value,
        line: token.line,
        col: token.col,
        endLine: token.line,
        endCol: token.col + token.length
      });
    }

    // Parenthesized expression: ( expr )
    if (this.match('PUNCTUATION', '(')) {
      const openParen = this.previous();
      const expr = this.parseExpression();
      const closeParen = this.consume('PUNCTUATION', ')', `Expected ')' to match '(' from line ${openParen.line}`);
      return new ASTNode('GroupingExpression', {
        expression: expr,
        line: openParen.line,
        col: openParen.col,
        endLine: closeParen ? closeParen.line : expr.line,
        endCol: closeParen ? closeParen.col + closeParen.length : expr.col
      });
    }

    // Unexpected token error
    this.error(token, `Unexpected token in expression: '${token.value}'`, `Provide a valid expression, variable name, or literal value.`);
    this.advance();
    return new ASTNode('ErrorNode', {
      line: token.line,
      col: token.col,
      value: token.value
    });
  }

  // -------------------------------------------------------------
  // Helpers & Error Synchronization
  // -------------------------------------------------------------

  isTypeKeyword(token) {
    if (!token || token.type !== 'KEYWORD') return false;
    return ['int', 'float', 'char', 'bool', 'void'].includes(token.value);
  }

  match(type, value = null) {
    if (this.check(type, value)) {
      this.advance();
      return true;
    }
    return false;
  }

  check(type, value = null) {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type !== type) return false;
    if (value !== null && token.value !== value) return false;
    return true;
  }

  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  isAtEnd() {
    return this.peek().type === 'EOF';
  }

  peek() {
    return this.tokens[this.current] || { type: 'EOF', value: '<EOF>', line: 0, col: 0, length: 0 };
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  consume(type, value, message, suggestion = '') {
    if (this.check(type, value)) {
      return this.advance();
    }
    const token = this.peek();
    this.error(token, message, suggestion);
    return null;
  }

  error(token, message, suggestion = '') {
    const err = {
      phase: 'Syntax',
      line: token.line || 1,
      col: token.col || 1,
      length: token.length || 1,
      message,
      suggestion
    };
    this.errors.push(err);
  }

  synchronize() {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().value === ';') return;

      switch (this.peek().value) {
        case 'int':
        case 'float':
        case 'char':
        case 'bool':
        case 'void':
        case 'if':
        case 'while':
        case 'for':
        case 'do':
        case 'return':
        case 'break':
        case 'continue':
        case '}':
          return;
      }

      this.advance();
    }
  }

  // -------------------------------------------------------------
  // Text Tree Representation
  // -------------------------------------------------------------

  static toTextTree(node, prefix = '', isLast = true) {
    if (!node) return '';

    let label = node.type;
    if (node.name) label += ` [${node.name}]`;
    if (node.value !== undefined) label += ` (${node.value})`;
    if (node.operator) label += ` '${node.operator}'`;
    if (node.dataType) label += ` <${node.dataType}>`;
    if (node.line) label += ` (L${node.line}:${node.col})`;

    const connector = isLast ? '└── ' : '├── ';
    let result = prefix + connector + label + '\n';

    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    const children = node.getChildren ? node.getChildren() : (node.children || []);

    children.forEach((child, index) => {
      const lastChild = index === children.length - 1;
      result += Parser.toTextTree(child, childPrefix, lastChild);
    });

    return result;
  }

  // -------------------------------------------------------------
  // Tree Layout Algorithm for SVG Visualization
  // Computes x, y coordinates and handles collapsed subtrees
  // -------------------------------------------------------------

  static computeLayout(root, options = {}) {
    const nodeWidth = options.nodeWidth || 130;
    const nodeHeight = options.nodeHeight || 44;
    const siblingGap = options.siblingGap || 25;
    const levelHeight = options.levelHeight || 80;

    let nextX = 0;

    function postOrder(node, depth) {
      if (!node) return;
      node.y = depth * levelHeight + 40;
      const children = (node.collapsed ? [] : (node.getChildren ? node.getChildren() : (node.children || [])));

      if (children.length === 0) {
        node.x = nextX;
        nextX += nodeWidth + siblingGap;
      } else {
        children.forEach(child => postOrder(child, depth + 1));
        const first = children[0];
        const last = children[children.length - 1];
        node.x = (first.x + last.x) / 2;
      }
    }

    postOrder(root, 0);

    // Compute bounds
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;

    function findBounds(node) {
      if (!node) return;
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
      const children = (node.collapsed ? [] : (node.getChildren ? node.getChildren() : (node.children || [])));
      children.forEach(findBounds);
    }

    findBounds(root);

    // Shift tree so minX starts with padding
    const padding = 60;
    const shiftX = padding - (minX === Infinity ? 0 : minX);

    function shiftTree(node) {
      if (!node) return;
      node.x += shiftX;
      const children = (node.collapsed ? [] : (node.getChildren ? node.getChildren() : (node.children || [])));
      children.forEach(shiftTree);
    }

    shiftTree(root);

    return {
      width: Math.max(800, (maxX - minX) + padding * 2 + nodeWidth),
      height: Math.max(500, maxY + nodeHeight + padding * 2)
    };
  }
}

// Export for browser and node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Parser, ASTNode };
}
