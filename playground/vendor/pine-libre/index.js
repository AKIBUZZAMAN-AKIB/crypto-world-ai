// src/lang/token.ts
var PineSyntaxError = class extends Error {
  line;
  col;
  code;
  constructor(message, line, col, code = "SYNTAX") {
    super(message);
    this.name = "PineSyntaxError";
    this.line = line;
    this.col = col;
    this.code = code;
  }
};

// src/lang/lexer.ts
var MULTI_CHAR_OPS = ["=>", ":=", "==", "!=", ">=", "<=", "+=", "-=", "*=", "/=", "%=", "?."];
var SINGLE_CHAR_OPS = /* @__PURE__ */ new Set(["+", "-", "*", "/", "%", ">", "<", "=", "?", ":", ",", "(", ")", "[", "]", ".", ";"]);
function isIdentStart(ch) {
  return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_";
}
function isIdentPart(ch) {
  return isIdentStart(ch) || ch >= "0" && ch <= "9";
}
function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}
function tokenize(source) {
  const tokens = [];
  const text = source.replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\r|\n/);
  const indentByLine = [];
  let bracketDepth = 0;
  let currentIndent = 0;
  let lineEmpty = true;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    const lineNo = lineIdx + 1;
    let col = 0;
    let indent = 0;
    while (col < raw.length && (raw[col] === " " || raw[col] === "	")) {
      indent += raw[col] === "	" ? 4 - indent % 4 : 1;
      col++;
    }
    indentByLine[lineNo] = indent;
    let i = col;
    const lineStartIndex = tokens.length;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === " " || ch === "	") {
        i++;
        continue;
      }
      if (ch === "/" && raw[i + 1] === "/") {
        break;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let out = "";
        let closed2 = false;
        while (j < raw.length) {
          const c = raw[j];
          if (c === "\\") {
            const esc = raw[j + 1];
            if (esc === void 0) break;
            switch (esc) {
              case "n":
                out += "\n";
                break;
              case "t":
                out += "	";
                break;
              case "r":
                out += "\r";
                break;
              case "\\":
                out += "\\";
                break;
              case '"':
                out += '"';
                break;
              case "'":
                out += "'";
                break;
              default:
                out += esc;
            }
            j += 2;
            continue;
          }
          if (c === quote) {
            closed2 = true;
            j++;
            break;
          }
          out += c;
          j++;
        }
        if (!closed2) throw new PineSyntaxError("Unterminated string literal", lineNo, i + 1);
        tokens.push({ type: "str", value: out, line: lineNo, col: i + 1, indent: 0 });
        i = j;
        continue;
      }
      if (ch === "#") {
        const literal = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/.exec(raw.slice(i));
        if (!literal) throw new PineSyntaxError("Invalid colour literal (expected #RRGGBB or #RRGGBBAA)", lineNo, i + 1);
        tokens.push({ type: "str", value: literal[0].toLowerCase(), line: lineNo, col: i + 1, indent: 0 });
        i += literal[0].length;
        continue;
      }
      if (isDigit(ch) || ch === "." && isDigit(raw[i + 1] ?? "")) {
        let j = i;
        while (j < raw.length && isDigit(raw[j])) j++;
        if (raw[j] === "." && isDigit(raw[j + 1] ?? "")) {
          j++;
          while (j < raw.length && isDigit(raw[j])) j++;
        } else if (raw[j] === "." && !isIdentStart(raw[j + 1] ?? "") && raw[j + 1] !== ".") {
          j++;
        }
        if (raw[j] === "e" || raw[j] === "E") {
          let k = j + 1;
          if (raw[k] === "+" || raw[k] === "-") k++;
          if (isDigit(raw[k] ?? "")) {
            k++;
            while (k < raw.length && isDigit(raw[k])) k++;
            j = k;
          }
        }
        const lexeme = raw.slice(i, j);
        const num = Number(lexeme);
        if (!Number.isFinite(num)) throw new PineSyntaxError(`Invalid number literal "${lexeme}"`, lineNo, i + 1);
        tokens.push({ type: "num", value: lexeme, num, line: lineNo, col: i + 1, indent: 0 });
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i;
        while (j < raw.length && isIdentPart(raw[j])) j++;
        tokens.push({ type: "ident", value: raw.slice(i, j), line: lineNo, col: i + 1, indent: 0 });
        i = j;
        continue;
      }
      const three = raw.slice(i, i + 3);
      const two = raw.slice(i, i + 2);
      if (three === "?.") {
        tokens.push({ type: "op", value: "?.", line: lineNo, col: i + 1, indent: 0 });
        i += 2;
        continue;
      }
      if (MULTI_CHAR_OPS.includes(two)) {
        tokens.push({ type: "op", value: two, line: lineNo, col: i + 1, indent: 0 });
        i += 2;
        continue;
      }
      if (SINGLE_CHAR_OPS.has(ch)) {
        if (ch === "(" || ch === "[") bracketDepth++;
        else if (ch === ")" || ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
        tokens.push({ type: "op", value: ch, line: lineNo, col: i + 1, indent: 0 });
        i++;
        continue;
      }
      throw new PineSyntaxError(`Unexpected character "${ch}"`, lineNo, i + 1);
    }
    lineEmpty = tokens.length === lineStartIndex;
    if (!lineEmpty) currentIndent = indent;
    if (bracketDepth === 0) {
      let nextIndent = -1;
      for (let k = lineIdx + 1; k < lines.length; k++) {
        const candidate = lines[k];
        const trimmed = candidate.trim();
        if (trimmed.length === 0 || trimmed.startsWith("//")) continue;
        let ind = 0;
        for (const c of candidate) {
          if (c === " ") ind++;
          else if (c === "	") ind += 4 - ind % 4;
          else break;
        }
        nextIndent = ind;
        break;
      }
      const last = tokens[tokens.length - 1];
      if (last && last.type !== "newline") {
        tokens.push({ type: "newline", value: "\n", line: lineNo, col: (raw.length || 0) + 1, indent: nextIndent });
      } else if (last && last.type === "newline") {
        last.indent = nextIndent;
      }
    } else {
      void currentIndent;
      void lineEmpty;
    }
  }
  for (const token of tokens) token.lineIndent = indentByLine[token.line] ?? 0;
  const tail = tokens[tokens.length - 1];
  if (tail && tail.type === "newline") tail.indent = -1;
  else tokens.push({ type: "newline", value: "\n", line: lines.length, col: 1, indent: -1 });
  tokens.push({ type: "eof", value: "", line: lines.length, col: 1, indent: -1 });
  return tokens;
}

// src/lang/parser.ts
var nextCallId = 1;
function resetCallIds() {
  nextCallId = 1;
}
var ASSIGN_OPS = /* @__PURE__ */ new Set(["=", ":=", "+=", "-=", "*=", "/="]);
var CONTINUATION_OPS = /* @__PURE__ */ new Set(["+", "-", "*", "/", "%", "==", "!=", ">", "<", ">=", "<=", "?", ":", ",", "=", ":=", "=>", "(", "["]);
function parseScript(source) {
  const lexerTokens = tokenize(source);
  const parser = new Parser(lexerTokens, source);
  const body = parser.parseProgram();
  return { version: detectVersion(source), body };
}
function detectVersion(source) {
  const m = /^\s*\/\/\s*@version\s*=\s*(\d+)/m.exec(source);
  return m ? Number(m[1]) : null;
}
var Parser = class _Parser {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.source = source;
  }
  tokens;
  source;
  pos = 0;
  /** Indentation of the statement currently being parsed. */
  stmtIndent = 0;
  /** Set when an indented block just ended, so the caller still sees a statement end. */
  blockEnded = false;
  /** Indentation of the line whose first token we are sitting on. */
  lineIndent = 0;
  /**
   * Inside a `switch` case the `=>` token separates the case test from its value, so an
   * `ident =>` must not be read as a one-parameter lambda while parsing the test.
   */
  suppressLambda = false;
  // ---------------------------------------------------------------- utilities
  peek() {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)];
  }
  peekAt(n2) {
    return this.tokens[Math.min(this.pos + n2, this.tokens.length - 1)];
  }
  next() {
    const t = this.peek();
    if (t.type !== "eof") this.pos++;
    return t;
  }
  isOp(value) {
    const t = this.peek();
    return t.type === "op" && t.value === value;
  }
  isKw(value) {
    const t = this.peek();
    return t.type === "ident" && t.value === value;
  }
  eatOp(value) {
    if (this.isOp(value)) {
      this.pos++;
      return true;
    }
    return false;
  }
  expectOp(value) {
    const t = this.peek();
    if (t.type !== "op" || t.value !== value) {
      throw new PineSyntaxError(`Expected "${value}" but found ${describe(t)}`, t.line, t.col);
    }
    this.pos++;
    return t;
  }
  error(message, t = this.peek(), code = "SYNTAX") {
    return new PineSyntaxError(message, t.line, t.col, code);
  }
  /**
   * Consume a newline that continues the current expression. Pine continues a statement
   * when the line break comes after an operator (or inside brackets, which the lexer
   * already collapses), so the decision is made from the previous token — never from the
   * indentation alone, which would swallow an `if`/`for` block.
   */
  cont() {
    for (; ; ) {
      const t = this.peek();
      if (t.type === "newline" && this.continuesExpression()) {
        this.pos++;
        if (t.indent >= 0) this.lineIndent = t.indent;
        continue;
      }
      return;
    }
  }
  continuesExpression() {
    const prev = this.tokens[this.pos - 1];
    if (!prev) return false;
    if (prev.type === "op" && CONTINUATION_OPS.has(prev.value)) return true;
    if (prev.type === "ident" && (prev.value === "and" || prev.value === "or" || prev.value === "not" || prev.value === "to" || prev.value === "by" || prev.value === "in")) return true;
    if (prev.type === "ident" && prev.value === "=>") return true;
    const next = this.peek();
    const first = this.tokens[this.pos + 1];
    void next;
    if (first && first.type === "op" && CONTINUATION_OPS.has(first.value) && !["(", "[", "=>", "?", ":"].includes(first.value)) {
      return true;
    }
    return false;
  }
  atStatementEnd() {
    if (this.blockEnded) return true;
    const t = this.peek();
    return t.type === "newline" || t.type === "eof" || t.type === "op" && t.value === ";";
  }
  /** Skip blank lines and any stray separators between statements. */
  skipSeparators() {
    for (; ; ) {
      const t = this.peek();
      if (t.type === "newline") {
        this.pos++;
        if (t.indent >= 0) this.lineIndent = t.indent;
        continue;
      }
      if (t.type === "op" && t.value === ";") {
        this.pos++;
        continue;
      }
      if (t.lineIndent !== void 0) this.lineIndent = t.lineIndent;
      return;
    }
  }
  // ---------------------------------------------------------------- program
  parseProgram() {
    const body = [];
    this.skipSeparators();
    while (this.peek().type !== "eof") {
      if (this.lineIndent > 0) {
        const t = this.peek();
        throw this.error("Unexpected indentation at top level", t);
      }
      const stmt = this.parseStatement(this.lineIndent);
      body.push(stmt);
      if (!this.atStatementEnd()) {
        const t = this.peek();
        throw this.error(`Unexpected ${describe(t)} after statement`, t);
      }
      this.skipSeparators();
    }
    return body;
  }
  // -------------------------------------------------------------- statements
  parseStatement(indent) {
    this.blockEnded = false;
    this.stmtIndent = indent;
    const t = this.peek();
    const pos = { line: t.line, col: t.col };
    if (t.type === "ident") {
      switch (t.value) {
        case "if":
          return { ...this.parseIfStatement(), ...pos };
        case "switch":
          return { ...this.parseSwitch(false), ...pos };
        case "for":
          return { ...this.parseFor(), ...pos };
        case "while": {
          this.pos++;
          const cond = this.parseExpr();
          const body = this.parseBodyBlock("while");
          return { kind: "while", cond, body, ...pos };
        }
        case "break":
          this.pos++;
          return { kind: "break", ...pos };
        case "continue":
          this.pos++;
          return { kind: "continue", ...pos };
        case "import":
          return { ...this.parseImport(), ...pos };
        case "export": {
          this.pos++;
          const inner = this.parseStatement(indent);
          if (inner.kind === "func" || inner.kind === "typedef" || inner.kind === "enumdef") inner.exported = true;
          return inner;
        }
        case "type":
          return { ...this.parseTypeDecl(), ...pos };
        case "enum":
          return { ...this.parseEnumDecl(), ...pos };
        case "method":
          return { ...this.parseMethodDecl(), ...pos };
        case "var":
        case "varip": {
          this.pos++;
          return this.parseAssignment(t.value, pos);
        }
        case "return":
          throw this.error("`return` is only valid inside a user-defined function body", t);
        default:
          break;
      }
      const fn = this.tryParseFunctionDecl();
      if (fn) return { ...fn, ...pos };
    }
    return this.parseAssignment("none", pos);
  }
  parseImport() {
    const start = this.next();
    const parts = [this.expectIdentValue("import path")];
    while (this.eatOp("/")) parts.push(this.expectIdentValue("import path segment"));
    const path = parts.join("/");
    if (!this.isKw("as")) throw this.error("Expected `as` in import statement");
    this.pos++;
    const alias = this.expectIdentValue("import alias");
    return { kind: "import", path, alias, line: start.line, col: start.col };
  }
  expectIdentValue(what) {
    const t = this.peek();
    if (t.type !== "ident" && t.type !== "num") throw this.error(`Expected ${what}`);
    this.pos++;
    return t.value;
  }
  /** A parameter's declared type, if any: `float x`, `array<float> xs`, `Point p`. */
  tryParseParamType() {
    const t = this.peek();
    const next = this.peekAt(1);
    if (t.type !== "ident") return null;
    if (next.type === "ident") {
      this.pos++;
      let type = t.value;
      if (this.isOp("<")) type += this.consumeTypeArgs();
      return type;
    }
    if (next.type === "op" && next.value === "<") {
      this.pos++;
      return t.value + this.consumeTypeArgs();
    }
    return null;
  }
  /** Consume `<…>` and return its source-ish text (`<float>`, `<string, float>`). */
  consumeTypeArgs() {
    let depth = 0;
    let out = "";
    for (; ; ) {
      const t = this.peek();
      if (t.type === "eof" || t.type === "newline") break;
      if (t.type === "op" && t.value === "<") depth++;
      if (t.type === "op" && t.value === ">") {
        depth--;
        out += ">";
        this.pos++;
        if (depth === 0) break;
        continue;
      }
      out += t.value;
      this.pos++;
    }
    return out;
  }
  /** `type Name` followed by an indented list of `float field = na` lines. */
  parseTypeDecl() {
    const start = this.next();
    const nameTok = this.peek();
    if (nameTok.type !== "ident") throw this.error("Expected a type name after `type`");
    this.pos++;
    const fields = [];
    const nl = this.peek();
    if (nl.type === "newline" && nl.indent > this.stmtIndent) {
      const fieldIndent = nl.indent;
      this.pos++;
      this.lineIndent = fieldIndent;
      for (; ; ) {
        this.skipSeparators();
        const cur = this.peek();
        if (cur.type === "eof" || this.lineIndent < fieldIndent) {
          this.blockEnded = true;
          break;
        }
        if (this.lineIndent > fieldIndent) throw this.error("Unexpected indentation in a type declaration", cur);
        const declaredType = this.tryParseParamType();
        const fieldTok = this.peek();
        if (fieldTok.type !== "ident") throw this.error("Expected a field name in the type declaration");
        this.pos++;
        let def = null;
        if (this.eatOp("=")) def = this.parseExpr();
        fields.push({ name: fieldTok.value, type: declaredType, def });
      }
    }
    return { kind: "typedef", name: nameTok.value, fields, line: start.line, col: start.col };
  }
  /** `enum Name` followed by an indented list of `key = value` lines. */
  parseEnumDecl() {
    const start = this.next();
    const nameTok = this.peek();
    if (nameTok.type !== "ident") throw this.error("Expected an enum name after `enum`");
    this.pos++;
    const members = [];
    const nl = this.peek();
    if (nl.type === "newline" && nl.indent > this.stmtIndent) {
      const memberIndent = nl.indent;
      this.pos++;
      this.lineIndent = memberIndent;
      for (; ; ) {
        this.skipSeparators();
        const cur = this.peek();
        if (cur.type === "eof" || this.lineIndent < memberIndent) {
          this.blockEnded = true;
          break;
        }
        if (cur.type !== "ident") throw this.error("Expected an enum member name", cur);
        this.pos++;
        let value = null;
        if (this.eatOp("=")) value = this.parseExpr();
        members.push({ name: cur.value, value });
      }
    }
    return { kind: "enumdef", name: nameTok.value, members, line: start.line, col: start.col };
  }
  /** `method name(Type self, …) => …` — a function whose first parameter is the receiver. */
  parseMethodDecl() {
    this.next();
    const fn = this.tryParseFunctionDecl();
    if (!fn) throw this.error("Expected a method declaration after `method`");
    return { ...fn, method: true };
  }
  tryParseFunctionDecl() {
    const start = this.pos;
    const nameTok = this.next();
    if (nameTok.type !== "ident" || !this.isOp("(")) {
      this.pos = start;
      return null;
    }
    if (!this.looksLikeFunctionDeclaration()) {
      this.pos = start;
      return null;
    }
    this.pos++;
    const params = [];
    if (!this.isOp(")")) {
      for (; ; ) {
        const declaredType = this.tryParseParamType();
        const p = this.peek();
        if (p.type !== "ident") throw this.error("Expected parameter name");
        this.pos++;
        let def = null;
        if (this.eatOp("=")) def = this.parseExpr();
        params.push({ name: p.value, def, type: declaredType });
        if (this.eatOp(",")) continue;
        break;
      }
    }
    this.expectOp(")");
    this.expectOp("=>");
    const { body, exprBody } = this.parseFunctionBody();
    return {
      kind: "func",
      name: nameTok.value,
      params,
      body,
      exprBody,
      id: nextCallId++,
      line: nameTok.line,
      col: nameTok.col
    };
  }
  /** Scan from an opening `(` to its match and report whether `=>` follows. */
  looksLikeFunctionDeclaration() {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === "eof" || t.type === "newline") return false;
      if (t.type === "op") {
        if (t.value === "(" || t.value === "[") depth++;
        else if (t.value === ")" || t.value === "]") {
          depth--;
          if (depth === 0) {
            const next = this.tokens[i + 1];
            return Boolean(next && next.type === "op" && next.value === "=>");
          }
        }
      }
    }
    return false;
  }
  parseFunctionBody() {
    const t = this.peek();
    if (t.type === "newline") {
      if (t.indent <= this.stmtIndent) {
        throw this.error("Expected an indented block after `=>`", t);
      }
      return { body: this.parseBlock(t.indent), exprBody: null };
    }
    const expr = this.parseExpr();
    return { body: [], exprBody: expr };
  }
  parseIfStatement() {
    const start = this.next();
    const cond = this.parseExpr();
    const then = this.parseBodyBlock("if");
    let elseBody = null;
    if (this.isKw("else")) {
      const elseTok = this.peek();
      this.pos++;
      if (this.isKw("if")) {
        elseBody = [this.parseIfStatement()];
        void elseTok;
      } else {
        elseBody = this.parseBodyBlock("else");
      }
    }
    return { kind: "if", cond, then, else: elseBody, exprMode: false, line: start.line, col: start.col };
  }
  parseBodyBlock(opener) {
    const t = this.peek();
    if (t.type === "newline") {
      const blockIndent = t.indent;
      if (blockIndent <= this.stmtIndent || blockIndent < 0) {
        throw this.error(`Expected an indented block after \`${opener}\``, t);
      }
      return this.parseBlock(blockIndent);
    }
    throw this.error(`Expected a new line and an indented block after \`${opener}\``, t);
  }
  /** Parse a block of statements at `blockIndent`; consumes the trailing dedent newline. */
  parseBlock(blockIndent) {
    const out = [];
    const savedStmtIndent = this.stmtIndent;
    const nl = this.peek();
    if (nl.type === "newline") {
      this.pos++;
      this.lineIndent = nl.indent;
    }
    for (; ; ) {
      this.skipSeparators();
      const t = this.peek();
      if (t.type === "eof") {
        this.blockEnded = true;
        break;
      }
      if (this.lineIndent < blockIndent) {
        this.blockEnded = true;
        break;
      }
      if (this.lineIndent > blockIndent) {
        throw this.error("Unexpected indentation", t);
      }
      const stmt = this.parseStatement(blockIndent);
      out.push(stmt);
      if (!this.atStatementEnd()) throw this.error(`Unexpected ${describe(this.peek())} after statement`);
    }
    this.stmtIndent = savedStmtIndent;
    return out;
  }
  parseFor() {
    const start = this.next();
    if (this.isOp("[")) {
      this.pos++;
      const first = this.peek();
      if (first.type !== "ident") throw this.error("Expected a loop variable name");
      this.pos++;
      this.expectOp(",");
      const second = this.peek();
      if (second.type !== "ident") throw this.error("Expected a second loop variable name");
      this.pos++;
      this.expectOp("]");
      if (!this.isKw("in")) throw this.error("Expected `in` in for statement");
      this.pos++;
      const iterable = this.parseExpr();
      const body2 = this.parseBodyBlock("for");
      return {
        kind: "forin",
        varName: first.value,
        varName2: second.value,
        iterable,
        body: body2,
        line: start.line,
        col: start.col
      };
    }
    const varTok = this.peek();
    if (varTok.type !== "ident") throw this.error("Expected a loop variable name");
    this.pos++;
    if (this.isKw("in")) {
      this.pos++;
      const iterable = this.parseExpr();
      const body2 = this.parseBodyBlock("for");
      return { kind: "forin", varName: varTok.value, iterable, body: body2, line: start.line, col: start.col };
    }
    if (!this.isOp("=")) throw this.error("Expected `=` or `in` in for statement");
    this.pos++;
    const from = this.parseExpr();
    if (!this.isKw("to")) throw this.error("Expected `to` in for statement");
    this.pos++;
    const to = this.parseExpr();
    let step = null;
    if (this.isKw("by")) {
      this.pos++;
      step = this.parseExpr();
    }
    const body = this.parseBodyBlock("for");
    return { kind: "for", varName: varTok.value, from, to, step, body, line: start.line, col: start.col };
  }
  parseSwitch(exprMode) {
    const start = this.next();
    let subject = null;
    const t = this.peek();
    if (t.type !== "newline") subject = this.parseExpr();
    const nl = this.peek();
    if (nl.type !== "newline" || nl.indent <= this.stmtIndent) {
      throw this.error("Expected an indented block of switch cases", nl);
    }
    const caseIndent = nl.indent;
    this.pos++;
    const savedStmtIndent = this.stmtIndent;
    this.lineIndent = nl.indent;
    const cases = [];
    for (; ; ) {
      this.skipSeparators();
      const cur = this.peek();
      if (cur.type === "eof" || this.lineIndent < caseIndent) {
        this.blockEnded = true;
        break;
      }
      if (this.lineIndent > caseIndent) throw this.error("Unexpected indentation in switch block", cur);
      this.stmtIndent = caseIndent;
      let test = null;
      if (!this.isOp("=>")) {
        const savedSuppress = this.suppressLambda;
        this.suppressLambda = true;
        try {
          test = this.parseExpr();
        } finally {
          this.suppressLambda = savedSuppress;
        }
      }
      this.expectOp("=>");
      let body = [];
      let exprBody = null;
      const after = this.peek();
      if (after.type === "newline" && after.indent > caseIndent) {
        body = this.parseBlock(after.indent);
      } else {
        exprBody = this.parseExpr();
      }
      cases.push({ test, body, exprBody });
      if (!this.atStatementEnd()) throw this.error(`Unexpected ${describe(this.peek())} after switch case`);
    }
    this.stmtIndent = savedStmtIndent;
    return { kind: "switch", subject, cases, exprMode, line: start.line, col: start.col };
  }
  parseAssignment(decl, pos) {
    this.tryParseTypeAnnotation();
    const targetExpr = this.parseExpr();
    if (!this.isOpAssign()) {
      if (decl !== "none") throw this.error("Expected an assignment after `var`/`varip`");
      return { kind: "expr", expr: targetExpr, ...pos };
    }
    const opTok = this.next();
    const targets = toTargets(targetExpr, (m) => this.error(m, opTok));
    const expr = this.parseExpr();
    return { kind: "assign", targets, op: opTok.value, decl, expr, ...pos };
  }
  isOpAssign() {
    const t = this.peek();
    return t.type === "op" && ASSIGN_OPS.has(t.value);
  }
  // ------------------------------------------------------------- expressions
  parseExpr() {
    return this.parseTernary();
  }
  parseTernary() {
    const cond = this.parseOr();
    this.cont();
    if (this.isOp("?")) {
      const t = this.next();
      const then = this.parseExpr();
      this.cont();
      this.expectOp(":");
      const elseExpr = this.parseExpr();
      return { kind: "ternary", cond, then, else: elseExpr, line: t.line, col: t.col };
    }
    return cond;
  }
  parseOr() {
    let left = this.parseAnd();
    for (; ; ) {
      this.cont();
      if (this.isKw("or")) {
        const t = this.next();
        const right = this.parseAnd();
        left = { kind: "bin", op: "or", left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseAnd() {
    let left = this.parseEquality();
    for (; ; ) {
      this.cont();
      if (this.isKw("and")) {
        const t = this.next();
        const right = this.parseEquality();
        left = { kind: "bin", op: "and", left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseEquality() {
    let left = this.parseComparison();
    for (; ; ) {
      this.cont();
      if (this.isOp("==") || this.isOp("!=")) {
        const t = this.next();
        const right = this.parseComparison();
        left = { kind: "bin", op: t.value, left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseComparison() {
    let left = this.parseAdditive();
    for (; ; ) {
      this.cont();
      if (this.isOp(">") || this.isOp("<") || this.isOp(">=") || this.isOp("<=")) {
        const t = this.next();
        const right = this.parseAdditive();
        left = { kind: "bin", op: t.value, left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    for (; ; ) {
      this.cont();
      if (this.isOp("+") || this.isOp("-")) {
        const t = this.next();
        const right = this.parseMultiplicative();
        left = { kind: "bin", op: t.value, left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    for (; ; ) {
      this.cont();
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const t = this.next();
        const right = this.parseUnary();
        left = { kind: "bin", op: t.value, left, right, line: t.line, col: t.col };
        continue;
      }
      return left;
    }
  }
  parseUnary() {
    this.cont();
    const t = this.peek();
    if (t.type === "op" && (t.value === "-" || t.value === "+")) {
      this.pos++;
      const arg = this.parseUnary();
      return t.value === "-" ? { kind: "un", op: "-", arg, line: t.line, col: t.col } : arg;
    }
    if (t.type === "ident" && t.value === "not") {
      this.pos++;
      const arg = this.parseUnary();
      return { kind: "un", op: "not", arg, line: t.line, col: t.col };
    }
    return this.parsePostfix();
  }
  // ----------------------------------------------------------- type annotations
  /**
   * Consume a balanced `<...>` type-argument list when one precedes a call:
   * `array.new<float>(0)`, `matrix.new<float>(2, 2)`, `map.new<string, float>()`.
   * The type arguments carry no runtime meaning here (values are untyped doubles,
   * strings or objects), so they are validated for balance and dropped.
   */
  tryTypeArgsBeforeCall() {
    if (!this.isOp("<")) return false;
    const start = this.pos;
    if (!this.skipTypeArgs()) {
      this.pos = start;
      return false;
    }
    if (this.isOp("(")) return true;
    this.pos = start;
    return false;
  }
  /** Skip `<a, b<c>>`; returns false (and restores nothing) when it is unbalanced. */
  skipTypeArgs() {
    const start = this.pos;
    if (!this.isOp("<")) return false;
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (!t) break;
      if (t.type === "op" && t.value === "<") depth++;
      else if (t.type === "op" && t.value === ">") {
        depth--;
        if (depth === 0) {
          this.pos++;
          return true;
        }
      } else if (!(t.type === "ident" || t.type === "op" && (t.value === "," || t.value === "."))) {
        break;
      }
      this.pos++;
    }
    this.pos = start;
    return false;
  }
  /** Reserved words that can never start a declaration's type annotation. */
  static NOT_A_TYPE = /* @__PURE__ */ new Set([
    "and",
    "or",
    "not",
    "if",
    "else",
    "for",
    "to",
    "by",
    "while",
    "var",
    "varip",
    "true",
    "false",
    "na",
    "break",
    "continue",
    "import",
    "export",
    "switch",
    "type",
    "method",
    "enum",
    "return",
    "in",
    "const",
    "simple",
    "series"
  ]);
  static TYPE_WORDS = /* @__PURE__ */ new Set(["int", "float", "bool", "string", "color", "line", "label", "box", "table", "linefill", "polyline", "array", "matrix", "map", "chart"]);
  static TYPE_QUALIFIERS = /* @__PURE__ */ new Set(["const", "simple", "series"]);
  /**
   * Consume a declaration's type annotation: `float x = …`, `array<float> a = …`,
   * `chart.point p = …`. Only fires when the pattern is `type ident (=|:=)`, so a cast
   * like `float(x)` and an ordinary assignment are untouched.
   */
  tryParseTypeAnnotation() {
    const start = this.pos;
    let t = this.tokens[this.pos];
    if (!t) return false;
    while (t && t.type === "ident" && _Parser.TYPE_QUALIFIERS.has(t.value)) {
      this.pos++;
      t = this.tokens[this.pos];
    }
    if (!t || t.type !== "ident" || _Parser.NOT_A_TYPE.has(t.value)) {
      this.pos = start;
      return false;
    }
    this.pos++;
    const dot = this.tokens[this.pos];
    if (t.value === "chart" && dot && dot.type === "op" && dot.value === ".") {
      const part = this.tokens[this.pos + 1];
      if (!part || part.type !== "ident") {
        this.pos = start;
        return false;
      }
      this.pos += 2;
    }
    if (this.isOp("<") && !this.skipTypeArgs()) {
      this.pos = start;
      return false;
    }
    const name = this.tokens[this.pos];
    const after = this.tokens[this.pos + 1];
    const isAssign = after && after.type === "op" && ASSIGN_OPS.has(after.value);
    if (!name || name.type !== "ident" || !isAssign) {
      this.pos = start;
      return false;
    }
    return true;
  }
  /**
   * Type hint inside a tuple pattern: `[float a, array<int> b] = f()`.
   * Only consumed when the annotation is followed by a name and then `,` or `]`.
   */
  tryParseTupleTypeAnnotation() {
    const start = this.pos;
    let t = this.tokens[this.pos];
    while (t && t.type === "ident" && _Parser.TYPE_QUALIFIERS.has(t.value)) {
      this.pos++;
      t = this.tokens[this.pos];
    }
    if (!t || t.type !== "ident" || _Parser.NOT_A_TYPE.has(t.value)) {
      this.pos = start;
      return false;
    }
    this.pos++;
    const dot = this.tokens[this.pos];
    if (t.value === "chart" && dot && dot.type === "op" && dot.value === ".") {
      const part = this.tokens[this.pos + 1];
      if (!part || part.type !== "ident") {
        this.pos = start;
        return false;
      }
      this.pos += 2;
    }
    if (this.isOp("<") && !this.skipTypeArgs()) {
      this.pos = start;
      return false;
    }
    const name = this.tokens[this.pos];
    const after = this.tokens[this.pos + 1];
    const closes = after && after.type === "op" && (after.value === "," || after.value === "]");
    if (!name || name.type !== "ident" || !closes) {
      this.pos = start;
      return false;
    }
    return true;
  }
  parsePostfix() {
    let expr = this.parseAtom();
    for (; ; ) {
      this.cont();
      if (this.isOp("[")) {
        const t = this.next();
        if (expr.kind === "history") {
          throw this.error("The `[]` operator can only be applied once to the same value", t);
        }
        const offset = this.parseExpr();
        this.expectOp("]");
        expr = { kind: "history", object: expr, offset, line: t.line, col: t.col };
        continue;
      }
      if (this.isOp(".")) {
        const t = this.next();
        const prop = this.peek();
        if (prop.type !== "ident") throw this.error('Expected a property name after "."');
        this.pos++;
        if (this.tryTypeArgsBeforeCall() || this.isOp("(")) {
          const args = this.parseArgs();
          const callee = {
            kind: "member",
            object: expr,
            prop: prop.value,
            line: t.line,
            col: t.col
          };
          expr = { kind: "call", callee, args, id: nextCallId++, line: t.line, col: t.col };
        } else {
          expr = { kind: "member", object: expr, prop: prop.value, line: t.line, col: t.col };
        }
        continue;
      }
      return expr;
    }
  }
  parseArgs() {
    this.expectOp("(");
    const args = [];
    if (this.eatOp(")")) return args;
    for (; ; ) {
      this.cont();
      const t = this.peek();
      if (t.type === "ident" && this.peekAt(1).type === "op" && this.peekAt(1).value === "=") {
        this.pos += 2;
        args.push({ name: t.value, value: this.parseExpr() });
      } else {
        args.push({ value: this.parseExpr() });
      }
      this.cont();
      if (this.eatOp(",")) {
        if (this.isOp(")")) {
          this.pos++;
          return args;
        }
        continue;
      }
      this.expectOp(")");
      return args;
    }
  }
  parseAtom() {
    this.cont();
    const t = this.peek();
    switch (t.type) {
      case "num":
        this.pos++;
        return { kind: "num", value: t.num, line: t.line, col: t.col };
      case "str":
        this.pos++;
        return { kind: "str", value: t.value, line: t.line, col: t.col };
      case "ident": {
        switch (t.value) {
          case "true":
          case "false":
            this.pos++;
            return { kind: "bool", value: t.value === "true", line: t.line, col: t.col };
          case "na": {
            if (this.peekAt(1).type === "op" && this.peekAt(1).value === "(") break;
            this.pos++;
            return { kind: "na", line: t.line, col: t.col };
          }
          case "if": {
            const stmt = this.parseIfStatement();
            return {
              kind: "if",
              cond: stmt.cond,
              then: stmt.then,
              else: stmt.else,
              exprMode: true,
              line: stmt.line,
              col: stmt.col
            };
          }
          case "switch": {
            const stmt = this.parseSwitch(true);
            return {
              kind: "switch",
              subject: stmt.subject,
              cases: stmt.cases,
              exprMode: true,
              line: stmt.line,
              col: stmt.col
            };
          }
          case "not":
          case "and":
          case "or":
            throw this.error(`Unexpected keyword "${t.value}" in expression`, t);
          default:
            break;
        }
        this.pos++;
        const generic = this.tryTypeArgsBeforeCall();
        if (generic || this.isOp("(")) {
          const args = this.parseArgs();
          const callee = { kind: "ident", name: t.value, line: t.line, col: t.col };
          return { kind: "call", callee, args, id: nextCallId++, line: t.line, col: t.col };
        }
        if (!this.suppressLambda && this.isOp("=>")) {
          this.pos++;
          const body = this.parseExpr();
          return { kind: "lambda", params: [{ name: t.value, def: null }], body: [], exprBody: body, line: t.line, col: t.col };
        }
        return { kind: "ident", name: t.value, line: t.line, col: t.col };
      }
      case "op": {
        if (t.value === "(") {
          const lambda = this.tryParseParenLambda();
          if (lambda) return lambda;
          this.pos++;
          const first = this.parseExpr();
          if (this.isOp(",")) {
            const items = [first];
            while (this.eatOp(",")) items.push(this.parseExpr());
            this.expectOp(")");
            return { kind: "tuple", items, line: t.line, col: t.col };
          }
          this.expectOp(")");
          return first;
        }
        if (t.value === "[") {
          this.pos++;
          const items = [];
          if (!this.isOp("]")) {
            for (; ; ) {
              this.tryParseTupleTypeAnnotation();
              items.push(this.parseExpr());
              if (this.eatOp(",")) {
                this.cont();
                if (this.isOp("]")) break;
                continue;
              }
              break;
            }
          }
          this.expectOp("]");
          return { kind: "array", items, line: t.line, col: t.col };
        }
        throw this.error(`Unexpected ${describe(t)}`, t);
      }
      case "newline":
      case "eof":
      default:
        throw this.error(`Unexpected ${describe(t)}`, t);
    }
  }
  /** `(a, b) => expr` lookahead. */
  tryParseParenLambda() {
    const start = this.pos;
    const t = this.peek();
    this.pos++;
    const params = [];
    if (!this.isOp(")")) {
      for (; ; ) {
        const p = this.peek();
        if (p.type !== "ident") {
          this.pos = start;
          return null;
        }
        this.pos++;
        params.push({ name: p.value, def: null });
        if (this.eatOp(",")) continue;
        break;
      }
    }
    if (!this.isOp(")") || this.peekAt(1).type !== "op" || this.peekAt(1).value !== "=>") {
      this.pos = start;
      return null;
    }
    this.pos += 2;
    const body = this.parseExpr();
    return { kind: "lambda", params, body: [], exprBody: body, line: t.line, col: t.col };
  }
};
function describe(t) {
  if (t.type === "eof") return "end of script";
  if (t.type === "newline") return "end of line";
  if (t.type === "str") return `string "${t.value}"`;
  return `"${t.value}"`;
}
function toTargets(expr, err) {
  if (expr.kind === "tuple" || expr.kind === "array") {
    const items = expr.items.map((item) => {
      const [t] = toTargets(item, err);
      return t;
    });
    return [{ kind: "tuple", items, pos: { line: expr.line, col: expr.col } }];
  }
  if (expr.kind === "ident") return [{ kind: "ident", name: expr.name, pos: { line: expr.line, col: expr.col } }];
  if (expr.kind === "member") {
    return [{ kind: "member", object: expr.object, prop: expr.prop, pos: { line: expr.line, col: expr.col } }];
  }
  throw err("Invalid assignment target");
}

// src/runtime/values.ts
var PineColor = class {
  css;
  constructor(css2) {
    this.css = css2;
  }
  /** Same colour at a different transparency (the v1–v4 `transp` argument). */
  withTransp(transp) {
    const rgb = parseCssColor(this.css);
    if (!rgb) return this;
    return colorFromRgba(rgb.r, rgb.g, rgb.b, transp);
  }
  toString() {
    return this.css;
  }
  valueOf() {
    return this.css;
  }
};
function isNa(v) {
  return v === null || v === void 0 || typeof v === "number" && Number.isNaN(v);
}
function toStr(v) {
  if (isNa(v)) return "NaN";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (v instanceof PineColor) return v.css;
  if (v instanceof PineArray) return v.toStr();
  if (typeof v === "object" && v.__pine === "ticker") {
    return String(v.symbol ?? "");
  }
  return String(v);
}
function toNum(v) {
  if (isNa(v)) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}
function toBool(v) {
  if (isNa(v)) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  return null;
}
function truthy(v) {
  return toBool(v) === true;
}
function add(a, b) {
  if (isNa(a) || isNa(b)) return null;
  if (typeof a === "string" || typeof b === "string") return toStr(a) + toStr(b);
  if (typeof a === "number" && typeof b === "number") return a + b;
  return null;
}
function sub(a, b) {
  if (isNa(a) || isNa(b)) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return null;
}
function mul(a, b) {
  if (isNa(a) || isNa(b)) return null;
  if (typeof a === "number" && typeof b === "number") return a * b;
  return null;
}
function div(a, b, fractional = false) {
  if (isNa(a) || isNa(b)) return null;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (b === 0) {
    if (!fractional && Number.isInteger(a) && Number.isInteger(b)) return null;
    return a === 0 ? null : a > 0 ? Infinity : -Infinity;
  }
  if (!fractional && Number.isInteger(a) && Number.isInteger(b)) return Math.trunc(a / b);
  return a / b;
}
function mod(a, b) {
  if (isNa(a) || isNa(b)) return null;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (b === 0) return null;
  const result = a - b * Math.floor(a / b);
  return Object.is(result, -0) ? 0 : result;
}
function eq(a, b) {
  if (isNa(a) || isNa(b)) return false;
  if (a instanceof PineColor && b instanceof PineColor) return a.css === b.css;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  if (typeof a === "string" && b && typeof b === "object" && b.__pine === "ticker") {
    return a === b.symbol;
  }
  if (typeof b === "string" && a && typeof a === "object" && a.__pine === "ticker") {
    return b === a.symbol;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a;
    const right = b;
    if (left.__pine && left.__pine === right.__pine && left.id !== void 0) return left.id === right.id;
  }
  if (a === b) return true;
  return false;
}
function cmp(op, a, b) {
  if (isNa(a) || isNa(b)) return false;
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case ">":
        return a > b;
      case "<":
        return a < b;
      case ">=":
        return a >= b;
      case "<=":
        return a <= b;
    }
  }
  if (typeof a === "string" && typeof b === "string") {
    switch (op) {
      case ">":
        return a > b;
      case "<":
        return a < b;
      case ">=":
        return a >= b;
      case "<=":
        return a <= b;
    }
  }
  return false;
}
var COLOR_NAMES = {
  aqua: "#00bcd4",
  black: "#000000",
  blue: "#2196f3",
  fuchsia: "#e040fb",
  gray: "#787b86",
  green: "#4caf50",
  lime: "#00e676",
  maroon: "#880e4f",
  navy: "#311b92",
  olive: "#808000",
  orange: "#ff9800",
  purple: "#9c27b0",
  red: "#ff5252",
  silver: "#b2b5be",
  teal: "#00897b",
  white: "#ffffff",
  yellow: "#ffeb3b"
};
function colorFromRgba(r, g, b, t = 0) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const alpha = Math.max(0, Math.min(100, t));
  return new PineColor(`rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${round3(1 - alpha / 100)})`);
}
function round3(x) {
  return Math.round(x * 1e3) / 1e3;
}
function parseCssColor(css2) {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css2.trim());
  if (hex) {
    const [, rgb, alpha] = hex;
    const r = parseInt(rgb.slice(0, 2), 16);
    const g = parseInt(rgb.slice(2, 4), 16);
    const b = parseInt(rgb.slice(4, 6), 16);
    const a = alpha ? parseInt(alpha, 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css2.trim());
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === void 0 ? 1 : Number(rgba[4])
    };
  }
  return null;
}
var PineArray = class _PineArray {
  __pine = "array";
  items;
  elemType;
  constructor(items = [], elemType = "float") {
    this.items = items;
    this.elemType = elemType;
  }
  get size() {
    return this.items.length;
  }
  toStr() {
    return `[${this.items.map((v) => toStr(v)).join(", ")}]`;
  }
  /** Pine `array.get`: out-of-range yields na. */
  get(index) {
    if (!Number.isFinite(index)) return null;
    const i = Math.trunc(index);
    if (i < 0 || i >= this.items.length) return null;
    return this.items[i] ?? null;
  }
  set(index, value) {
    const i = Math.trunc(index);
    while (this.items.length < i) this.items.push(null);
    this.items[i] = value;
  }
  push(value) {
    this.items.push(value);
  }
  pop() {
    return this.items.length > 0 ? this.items.pop() ?? null : null;
  }
  shift() {
    return this.items.length > 0 ? this.items.shift() ?? null : null;
  }
  unshift(value) {
    this.items.unshift(value);
  }
  clear() {
    this.items.length = 0;
  }
  /** Deep-ish copy (copies the array, not the contained objects — same as Pine). */
  clone() {
    return new _PineArray(this.items.slice(), this.elemType);
  }
};
function isArray(v) {
  return v instanceof PineArray;
}

// src/runtime/errors.ts
var PineRuntimeError = class extends Error {
  code;
  line;
  col;
  bar;
  constructor(message, code = "SCRIPT_ERROR", info = {}) {
    super(message);
    this.name = "PineRuntimeError";
    this.code = code;
    if (info.line !== void 0) this.line = info.line;
    if (info.col !== void 0) this.col = info.col;
    if (info.bar !== void 0) this.bar = info.bar;
  }
  /** Human-readable one-liner used in engine diagnostics. */
  describe() {
    const at = this.line !== void 0 ? ` (line ${this.line})` : "";
    const on = this.bar !== void 0 ? ` [bar ${this.bar}]` : "";
    return `${this.message}${at}${on}`;
  }
};

// src/engine/constant.ts
function evalConst(expr, env) {
  switch (expr.kind) {
    case "num":
      return expr.value;
    case "str":
      return expr.value;
    case "bool":
      return expr.value;
    case "na":
      return null;
    case "un":
      return expr.op === "not" ? !evalConst(expr.arg, env) : negate(evalConst(expr.arg, env));
    case "bin": {
      const left = evalConst(expr.left, env);
      const right = evalConst(expr.right, env);
      return binary(expr.op, left, right);
    }
    case "ternary":
      return evalConst(expr.cond, env) ? evalConst(expr.then, env) : evalConst(expr.else, env);
    case "member": {
      if (expr.object.kind === "member" && expr.object.object.kind === "ident") {
        const outer = expr.object.object.name;
        const inner = expr.object.prop;
        if (outer === "strategy" && inner === "commission") return expr.prop;
      }
      const ns = expr.object.kind === "ident" ? expr.object.name : "";
      const prop = expr.prop;
      if (ns === "syminfo") {
        const info = env.market.symbolInfo ?? {};
        if (prop === "ticker" || prop === "tickerid") return info["ticker"] ?? env.market.symbol;
        if (prop === "mintick") return info["mintick"] ?? 0.01;
        if (prop === "currency") return info["currency"] ?? "USD";
        if (prop === "timezone") return info["timezone"] ?? "UTC";
        if (prop === "type") return info["type"] ?? "crypto";
        if (prop === "root") return info["root"] ?? env.market.symbol;
        if (prop === "session") return info["session"] ?? "24x7";
        return null;
      }
      if (ns === "timeframe" && prop === "period") return env.market.timeframe;
      if (ns === "timeframe" && prop === "multiplier") return Number(/^(\d+)/.exec(env.market.timeframe)?.[1] ?? 1);
      if (ns === "color" && prop in COLOR_NAMES) return new PineColor(COLOR_NAMES[prop]);
      if (ns === "plot" || ns === "shape" || ns === "location" || ns === "size" || ns === "format") return prop;
      if (ns === "strategy") {
        if (prop === "long") return 1;
        if (prop === "short") return -1;
        return prop;
      }
      throw new PineRuntimeError(`"${ns}.${prop}" is not a constant expression`, "TYPE_ERROR", { line: expr.line });
    }
    case "call": {
      const callee = expr.callee.kind === "ident" ? expr.callee.name : expr.callee.kind === "member" && expr.callee.object.kind === "ident" ? `${expr.callee.object.name}.${expr.callee.prop}` : "";
      if (callee.startsWith("input")) return env.inputDefault(expr, callee);
      if (callee === "str.tostring") {
        const v = expr.args[0] ? evalConst(expr.args[0].value, env) : null;
        return toStr(v);
      }
      if (callee === "color.new" || callee === "color.rgb") {
        const base3 = expr.args[0] ? evalConst(expr.args[0].value, env) : null;
        const transp = expr.args[1] ? Number(evalConst(expr.args[1].value, env)) : 0;
        if (base3 instanceof PineColor) return new PineColor(withAlpha(base3.css, transp));
        return null;
      }
      throw new PineRuntimeError(`"${callee || "call"}" is not a constant expression`, "TYPE_ERROR", { line: expr.line });
    }
    case "ident": {
      const bound = env.bindings?.get(expr.name);
      if (bound) return evalConst(bound, env);
      throw new PineRuntimeError(`"${expr.name}" is not a constant`, "TYPE_ERROR", { line: expr.line });
    }
    default:
      throw new PineRuntimeError("Expression is not constant", "TYPE_ERROR", { line: expr.line });
  }
}
function negate(v) {
  return typeof v === "number" ? -v : null;
}
function binary(op, left, right) {
  if (op === "+" && (typeof left === "string" || typeof right === "string")) return toStr(left) + toStr(right);
  const a = typeof left === "number" ? left : null;
  const b = typeof right === "number" ? right : null;
  switch (op) {
    case "+":
      return a === null || b === null ? null : a + b;
    case "-":
      return a === null || b === null ? null : a - b;
    case "*":
      return a === null || b === null ? null : a * b;
    case "/":
      return a === null || b === null || b === 0 ? null : a / b;
    case "%":
      return a === null || b === null || b === 0 ? null : a % b;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return a !== null && b !== null && a > b;
    case "<":
      return a !== null && b !== null && a < b;
    case ">=":
      return a !== null && b !== null && a >= b;
    case "<=":
      return a !== null && b !== null && a <= b;
    case "and":
      return Boolean(left) && Boolean(right);
    case "or":
      return Boolean(left) || Boolean(right);
    default:
      return null;
  }
}
function withAlpha(css2, transp) {
  const hex = /^#([0-9a-f]{6})$/i.exec(css2);
  if (!hex) return css2;
  const rgb = hex[1];
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, 1 - transp / 100))})`;
}

// src/lang/legacy.ts
var RENAMED_IN = {
  // v4 moved these into namespaces.
  color: 4,
  // v5 removed/renamed these outright.
  iff: 5,
  offset: 5,
  input: 5,
  study: 5,
  security: 5,
  tickerid: 5
};
var LEGACY_CALLS = {
  "abs": "math.abs",
  "acos": "math.acos",
  "alma": "ta.alma",
  "asin": "math.asin",
  "atan": "math.atan",
  "atr": "ta.atr",
  "avg": "math.avg",
  "barsince": "ta.barsince",
  "bb": "ta.bb",
  "bbw": "ta.bbw",
  "cci": "ta.cci",
  "ceil": "math.ceil",
  "change": "ta.change",
  "cmo": "ta.cmo",
  "cog": "ta.cog",
  "correlation": "ta.correlation",
  "cos": "math.cos",
  "cross": "ta.cross",
  "crossover": "ta.crossover",
  "crossunder": "ta.crossunder",
  "cum": "ta.cum",
  "dev": "ta.dev",
  "dividends": "request.dividends",
  "dmi": "ta.dmi",
  "earnings": "request.earnings",
  "ema": "ta.ema",
  "exp": "math.exp",
  "falling": "ta.falling",
  "financial": "request.financial",
  "floor": "math.floor",
  "heikinashi": "ticker.heikinashi",
  "highest": "ta.highest",
  "highestbars": "ta.highestbars",
  "hma": "ta.hma",
  "kagi": "ticker.kagi",
  "kc": "ta.kc",
  "kcw": "ta.kcw",
  "linebreak": "ticker.linebreak",
  "linreg": "ta.linreg",
  "log": "math.log",
  "log10": "math.log10",
  "lowest": "ta.lowest",
  "lowestbars": "ta.lowestbars",
  "macd": "ta.macd",
  "max": "math.max",
  "median": "ta.median",
  "mfi": "ta.mfi",
  "min": "math.min",
  "mode": "ta.mode",
  "mom": "ta.mom",
  "percentile_linear_interpolation": "ta.percentile_linear_interpolation",
  "percentile_nearest_rank": "ta.percentile_nearest_rank",
  "percentrank": "ta.percentrank",
  "pivothigh": "ta.pivothigh",
  "pivotlow": "ta.pivotlow",
  "pointfigure": "ticker.pointfigure",
  "pow": "math.pow",
  "quandl": "request.quandl",
  "random": "math.random",
  "range": "ta.range",
  "renko": "ticker.renko",
  "rising": "ta.rising",
  "rma": "ta.rma",
  "roc": "ta.roc",
  "round": "math.round",
  "round_to_mintick": "math.round_to_mintick",
  "rsi": "ta.rsi",
  "sar": "ta.sar",
  "security": "request.security",
  "sign": "math.sign",
  "sin": "math.sin",
  "sma": "ta.sma",
  "splits": "request.splits",
  "sqrt": "math.sqrt",
  "stdev": "ta.stdev",
  "stoch": "ta.stoch",
  "study": "indicator",
  "sum": "math.sum",
  "supertrend": "ta.supertrend",
  "swma": "ta.swma",
  "tan": "math.tan",
  "tickerid": "ticker.new",
  "todegrees": "math.todegrees",
  "tonumber": "str.tonumber",
  "toradians": "math.toradians",
  "tostring": "str.tostring",
  "tr": "ta.tr",
  "tsi": "ta.tsi",
  "valuewhen": "ta.valuewhen",
  "variance": "ta.variance",
  "vwap": "ta.vwap",
  "vwma": "ta.vwma",
  "wma": "ta.wma",
  "wpr": "ta.wpr"
};
var LEGACY_SERIES = {
  "accdist": "ta.accdist",
  "iii": "ta.iii",
  "nvi": "ta.nvi",
  "obv": "ta.obv",
  "pvi": "ta.pvi",
  "pvt": "ta.pvt",
  "tr": "ta.tr",
  "vwap": "ta.vwap",
  "wad": "ta.wad",
  "wvad": "ta.wvad"
};
var LEGACY_CONSTANTS = {
  "aqua": "color.aqua",
  "black": "color.black",
  "blue": "color.blue",
  "fuchsia": "color.fuchsia",
  "gray": "color.gray",
  "green": "color.green",
  "lime": "color.lime",
  "maroon": "color.maroon",
  "navy": "color.navy",
  "olive": "color.olive",
  "orange": "color.orange",
  "purple": "color.purple",
  "red": "color.red",
  "silver": "color.silver",
  "teal": "color.teal",
  "white": "color.white",
  "yellow": "color.yellow",
  "line": "plot.style_line",
  "stepline": "plot.style_stepline",
  "histogram": "plot.style_histogram",
  "columns": "plot.style_columns",
  "circles": "plot.style_circles",
  "area": "plot.style_area",
  "cross": "plot.style_cross",
  "linebr": "plot.style_linebr",
  "steplinebr": "plot.style_steplinebr",
  "histogrambr": "plot.style_histogrambr",
  "columnsbr": "plot.style_columnsbr",
  "areabr": "plot.style_areabr",
  "stepline_diamond": "plot.style_stepline_diamond",
  "solid": "hline.style_solid",
  "dotted": "hline.style_dotted",
  "dashed": "hline.style_dashed",
  "sunday": "dayofweek.sunday",
  "monday": "dayofweek.monday",
  "tuesday": "dayofweek.tuesday",
  "wednesday": "dayofweek.wednesday",
  "thursday": "dayofweek.thursday",
  "friday": "dayofweek.friday",
  "saturday": "dayofweek.saturday",
  period: "timeframe.period",
  "timeframe.period": "timeframe.period",
  interval: "timeframe.multiplier",
  isintraday: "timeframe.isintraday",
  isdaily: "timeframe.isdaily",
  isweekly: "timeframe.isweekly",
  ismonthly: "timeframe.ismonthly",
  isdwm: "timeframe.isdwm",
  isseconds: "timeframe.isseconds",
  isminutes: "timeframe.isminutes",
  ticker: "syminfo.ticker",
  tickerid: "syminfo.tickerid",
  n: "bar_index"
};
var LEGACY_INPUT_TYPES = {
  integer: "int",
  int: "int",
  float: "float",
  bool: "bool",
  string: "string",
  source: "source",
  session: "session",
  symbol: "symbol",
  resolution: "timeframe",
  timeframe: "timeframe",
  color: "color"
};
var LEGACY_PARAMS = {
  resolution: "timeframe",
  resolution_gaps: "timeframe_gaps",
  long: "direction"
};
function legacyParamFor(name) {
  for (const [legacy, current] of Object.entries(LEGACY_PARAMS)) {
    if (current === name) return legacy;
  }
  return null;
}
function legacyCall(name, version) {
  if (version > 4) return null;
  const renamed = RENAMED_IN[name];
  if (renamed !== void 0 && version >= renamed) return null;
  if (name === "security" && version <= 4) return "request.security";
  if (name === "study" && version <= 4) return "indicator";
  if (name === "tickerid" && version <= 4) return "ticker.new";
  const target = LEGACY_CALLS[name];
  if (!target || target === name) return null;
  return target;
}
function legacyValue(name, version) {
  if (version > 4) return null;
  const series = LEGACY_SERIES[name];
  if (series) return series;
  return LEGACY_CONSTANTS[name] ?? null;
}
function legacyInputType(name, version) {
  if (version > 4) return null;
  return LEGACY_INPUT_TYPES[name] ?? null;
}

// src/engine/analyze.ts
var STRATEGY_PROP_SPECS = {
  initial_capital: { type: "float", def: 1e6 },
  currency: { type: "string", def: "USD" },
  commission_type: { type: "string", def: "percent", options: ["percent", "cash_per_order", "cash_per_contract"] },
  commission_value: { type: "float", def: 0 },
  slippage: { type: "int", def: 0 },
  default_qty_type: { type: "string", def: "fixed", options: ["fixed", "cash", "percent_of_equity", "shares"] },
  default_qty_value: { type: "float", def: 1 },
  process_orders_on_close: { type: "bool", def: false },
  calc_on_order_fills: { type: "bool", def: false },
  calc_on_every_tick: { type: "bool", def: false },
  margin_long: { type: "float", def: 0 },
  margin_short: { type: "float", def: 0 },
  pyramiding: { type: "int", def: 0 }
};
var INDICATOR_PROP_SPECS = {
  // Only published when the script declares them: an indicator has no meaningful
  // engine-side default for these.
  precision: { type: "int" },
  max_bars_back: { type: "int" }
};
var INPUT_TYPES = {
  "input.int": "int",
  "input.float": "float",
  "input.price": "price",
  "input.bool": "bool",
  "input.string": "string",
  "input.text_area": "text_area",
  "input.symbol": "symbol",
  "input.timeframe": "timeframe",
  "input.session": "session",
  "input.time": "time",
  "input.color": "color",
  "input.source": "source",
  "input.enum": "string"
};
function constEnvFor(market, inputDefaults) {
  const env = {
    market,
    inputDefault: (node, callee) => inputDefaultValue(node, callee, env)
  };
  void inputDefaults;
  return env;
}
function analyze(script, opts) {
  const env = {
    market: opts.market,
    inputDefault: (node, callee) => inputDefaultValue(node, callee, env)
  };
  let declaration = null;
  let declName = "";
  const imports = [];
  for (const stmt of script.body) {
    if (stmt.kind === "import") imports.push({ path: stmt.path, alias: stmt.alias, line: stmt.line });
    if (stmt.kind === "expr" && stmt.expr.kind === "call") {
      const callee = stmt.expr.callee;
      if (callee.kind === "ident" && ["indicator", "strategy", "study", "library"].includes(callee.name)) {
        const version = script.version ?? 1;
        if (callee.name === "study" && version >= 5) {
          throw new PineRuntimeError(
            "study() was renamed indicator() in Pine v5",
            "UNKNOWN_FUNCTION",
            { line: callee.line }
          );
        }
        if (callee.name === "indicator" && version <= 4) {
          throw new PineRuntimeError(
            "indicator() does not exist before Pine v5; use study()",
            "UNKNOWN_FUNCTION",
            { line: callee.line }
          );
        }
        declaration = stmt;
        declName = callee.name;
      }
    }
  }
  const warnings = [];
  const declarationArgs = /* @__PURE__ */ new Map();
  if (declaration && declaration.expr.kind === "call") {
    for (const arg of declaration.expr.args) {
      const name = arg.name ?? positionalName(declName, declaration.expr.args.indexOf(arg));
      if (!name) continue;
      try {
        declarationArgs.set(name, evalConst(arg.value, env));
      } catch {
      }
    }
  } else {
    warnings.push("script has no indicator()/strategy() declaration; using defaults");
  }
  const isStrategy = declName === "strategy";
  const title = stringOf(declarationArgs.get("title")) ?? opts.instanceId;
  const meta = {
    title,
    overlay: Boolean(declarationArgs.get("overlay") ?? false)
  };
  const shorttitle = stringOf(declarationArgs.get("shorttitle"));
  if (shorttitle) meta.shorttitle = shorttitle;
  const precision = numberOf(declarationArgs.get("precision"));
  if (precision !== null) meta.precision = Math.trunc(precision);
  const format = stringOf(declarationArgs.get("format"));
  if (format) meta.format = format;
  const inputs = [];
  const inputDefaults = {};
  const inputKeys = /* @__PURE__ */ new Map();
  const usedKeys = /* @__PURE__ */ new Set();
  const addInput = (call, callee, keyHint) => {
    const type = INPUT_TYPES[callee] ?? legacyInputType2(call);
    const schema = buildInputSchema(call, callee, type, env, keyHint, usedKeys);
    if (!schema) return;
    inputs.push(schema);
    inputKeys.set(call.id, schema.key);
    inputDefaults[schema.key] = schema.defval;
  };
  for (const stmt of script.body) {
    walkStatement(stmt, {
      onInput: (call, callee) => {
        if (stmt.kind === "assign" && stmt.targets.length === 1 && stmt.expr === call) {
          const target = stmt.targets[0];
          if (target && target.kind === "ident") {
            addInput(call, callee, target.name);
            return;
          }
        }
        addInput(call, callee, null);
      }
    });
  }
  const propSpecs = isStrategy ? STRATEGY_PROP_SPECS : INDICATOR_PROP_SPECS;
  const props = [];
  const propDefaults = {};
  for (const [name, spec] of Object.entries(propSpecs)) {
    const declared = declarationArgs.get(name);
    const hostDefault = opts.defaultProps?.[name];
    const implicit = spec.def === 0 && (name === "margin_long" || name === "margin_short") && (script.version ?? 1) >= 6 ? 100 : spec.def ?? null;
    const defval = declared !== void 0 ? toInputValue(declared) : hostDefault !== void 0 ? hostDefault : implicit;
    if (defval === null || defval === void 0) continue;
    const schema = { key: name, title: propTitle(name), type: spec.type, defval };
    if (spec.options) schema.options = spec.options;
    props.push(schema);
    propDefaults[name] = defval;
  }
  const securities = [];
  const bindings = /* @__PURE__ */ new Map();
  for (const stmt of script.body) {
    if (stmt.kind === "assign" && stmt.op === "=" && stmt.targets.length === 1) {
      const target = stmt.targets[0];
      if (target && target.kind === "ident") bindings.set(target.name, stmt.expr);
    }
  }
  env.bindings = bindings;
  const securityCalls = [];
  let reactsToViewport = false;
  for (const stmt of script.body) {
    walkStatement(stmt, {
      onCall: (call, callee) => {
        const securityName = callee === "security" && (script.version ?? 1) <= 4 ? "request.security" : callee;
        if (securityName === "request.security" || securityName === "request.security_lower_tf") {
          const legacy = (script.version ?? 1) <= 4;
          const argAt = (index, name) => {
            const named = call.args.find((a) => a.name === name);
            if (named) return named.value;
            if (legacy) {
              const legacyName = name === "timeframe" ? "resolution" : name;
              const found = call.args.find((a) => a.name === legacyName);
              if (found) return found.value;
            }
            return call.args.filter((a) => a.name === void 0)[index]?.value;
          };
          const symbolArg = legacySymbol(argAt(0, "symbol"), legacy);
          const tfArg = legacySymbol(argAt(1, "timeframe"), legacy);
          if (!symbolArg || !tfArg) return;
          securityCalls.push({ callId: call.id, symbolExpr: symbolArg, timeframeExpr: tfArg, lower: securityName === "request.security_lower_tf" });
          try {
            const symbol = toStr(evalConst(symbolArg, env));
            const timeframe = toStr(evalConst(tfArg, env));
            if (symbol && timeframe) {
              const exists = securities.some((s2) => s2.symbol === symbol && s2.timeframe === timeframe);
              if (!exists) securities.push({ symbol, timeframe, callId: call.id });
            }
          } catch {
            warnings.push("a request.security() call has non-constant symbol/timeframe arguments and was not pre-fetched");
          }
        }
      },
      onMember: (member) => {
        if (member.object.kind === "ident" && member.object.name === "chart") reactsToViewport = true;
      }
    });
  }
  return {
    script,
    meta,
    isStrategy,
    declarationArgs,
    inputs,
    inputDefaults,
    inputKeys,
    props,
    propDefaults,
    imports,
    securities,
    securityCalls,
    reactsToViewport,
    warnings
  };
}
function positionalName(declName, index) {
  if (declName === "library") return null;
  switch (index) {
    case 0:
      return "title";
    case 1:
      return "shorttitle";
    case 2:
      return "overlay";
    case 3:
      return "format";
    case 4:
      return "precision";
    default:
      return null;
  }
}
function propTitle(name) {
  return name.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function stringOf(v) {
  return typeof v === "string" ? v : null;
}
function numberOf(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function toInputValue(v) {
  if (v instanceof PineColor) return v.css;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return null;
}
function inputDefaultValue(call, callee, env) {
  const first = call.args.find((a) => a.name === "defval")?.value ?? call.args.find((a) => a.name === void 0)?.value;
  if (!first) return null;
  return evalConst(first, env);
}
var LEGACY_INPUT_TYPES2 = {
  integer: "int",
  int: "int",
  float: "float",
  bool: "bool",
  string: "string",
  source: "source",
  session: "session",
  symbol: "symbol",
  resolution: "timeframe",
  timeframe: "timeframe",
  color: "color"
};
function legacySymbol(expr, legacy) {
  if (!legacy || !expr || expr.kind !== "ident") return expr;
  const target = LEGACY_CONSTANTS[expr.name];
  if (!target) return expr;
  const [objectName, prop] = target.split(".");
  if (!objectName || !prop) return expr;
  return { kind: "member", object: { kind: "ident", name: objectName, line: expr.line, col: expr.col }, prop, line: expr.line, col: expr.col };
}
function legacyInputType2(call) {
  const positional = call.args.filter((a) => a.name === void 0).map((a) => a.value);
  const declared = call.args.find((a) => a.name === "type")?.value ?? positional[2];
  if (declared) {
    if (declared.kind === "ident" && LEGACY_INPUT_TYPES2[declared.name]) return LEGACY_INPUT_TYPES2[declared.name];
    if (declared.kind === "member" && declared.prop in LEGACY_INPUT_TYPES2) return LEGACY_INPUT_TYPES2[declared.prop];
  }
  const def = call.args.find((a) => a.name === "defval")?.value ?? positional[0];
  if (def?.kind === "ident") return "source";
  if (def?.kind === "str") return "string";
  if (def?.kind === "bool") return "bool";
  return "float";
}
function buildInputSchema(call, callee, type, env, keyHint, usedKeys) {
  const positional = call.args.filter((a) => a.name === void 0).map((a) => a.value);
  const named = (name) => call.args.find((a) => a.name === name)?.value;
  const defExpr = named("defval") ?? positional[0];
  let defval = null;
  if (defExpr && type === "source" && defExpr.kind === "ident") {
    defval = defExpr.name;
  } else if (defExpr) {
    try {
      defval = evalConst(defExpr, env);
    } catch {
      defval = null;
    }
  }
  let title = "";
  try {
    const titleExpr = named("title") ?? positional[1];
    if (titleExpr) title = toStr(evalConst(titleExpr, env));
  } catch {
    title = "";
  }
  const baseKey = keyHint ?? title ?? "";
  if (!baseKey) return null;
  let key = baseKey;
  let suffix = 2;
  while (usedKeys.has(key)) key = `${baseKey}_${suffix++}`;
  usedKeys.add(key);
  const schema = {
    key,
    title: title || key,
    type,
    defval: toInputValue(defval) ?? (type === "bool" ? false : type === "string" || type === "source" ? "" : 0)
  };
  const numeric2 = (name, positionalIndex) => {
    const expr = named(name) ?? positional[positionalIndex];
    if (!expr) return void 0;
    try {
      const v = evalConst(expr, env);
      return typeof v === "number" ? v : void 0;
    } catch {
      return void 0;
    }
  };
  const min = numeric2("minval", 2);
  if (min !== void 0) schema.min = min;
  const max = numeric2("maxval", 3);
  if (max !== void 0) schema.max = max;
  const step = numeric2("step", 4);
  if (step !== void 0) schema.step = step;
  const optionsExpr = named("options");
  if (optionsExpr && optionsExpr.kind === "array") {
    const options = [];
    for (const item of optionsExpr.items) {
      try {
        options.push(toStr(evalConst(item, env)));
      } catch {
      }
    }
    if (options.length > 0) schema.options = options;
  }
  const text = (name) => {
    const expr = named(name);
    if (!expr) return void 0;
    try {
      const v = evalConst(expr, env);
      return typeof v === "string" ? v : void 0;
    } catch {
      return void 0;
    }
  };
  const group = text("group");
  if (group !== void 0) schema.group = group;
  const inline = text("inline");
  if (inline !== void 0) schema.inline = inline;
  const tooltip = text("tooltip");
  if (tooltip !== void 0) schema.tooltip = tooltip;
  const tab = text("display");
  void tab;
  if (type === "source") {
    const expr = named("defval") ?? positional[0];
    if (expr && expr.kind === "ident") schema.defval = expr.name;
    else if (typeof schema.defval !== "string" || schema.defval === "") schema.defval = "close";
  }
  return schema;
}
function calleeName(expr) {
  if (expr.kind === "ident") return expr.name;
  if (expr.kind === "member" && expr.object.kind === "ident") return `${expr.object.name}.${expr.prop}`;
  return "";
}
function walkStatement(stmt, v) {
  switch (stmt.kind) {
    case "expr":
      walkExpr(stmt.expr, v);
      break;
    case "assign":
      walkExpr(stmt.expr, v);
      break;
    case "if":
      walkExpr(stmt.cond, v);
      stmt.then.forEach((s2) => walkStatement(s2, v));
      stmt.else?.forEach((s2) => walkStatement(s2, v));
      break;
    case "for":
      walkExpr(stmt.from, v);
      walkExpr(stmt.to, v);
      if (stmt.step) walkExpr(stmt.step, v);
      stmt.body.forEach((s2) => walkStatement(s2, v));
      break;
    case "forin":
      walkExpr(stmt.iterable, v);
      stmt.body.forEach((s2) => walkStatement(s2, v));
      break;
    case "switch":
      if (stmt.subject) walkExpr(stmt.subject, v);
      for (const c of stmt.cases) {
        if (c.test) walkExpr(c.test, v);
        if (c.exprBody) walkExpr(c.exprBody, v);
        c.body.forEach((s2) => walkStatement(s2, v));
      }
      break;
    case "func":
      if (stmt.exprBody) walkExpr(stmt.exprBody, v);
      stmt.params.forEach((p) => p.def && walkExpr(p.def, v));
      stmt.body.forEach((s2) => walkStatement(s2, v));
      break;
    case "return":
      if (stmt.expr) walkExpr(stmt.expr, v);
      break;
    default:
      break;
  }
}
function walkExpr(expr, v) {
  switch (expr.kind) {
    case "call": {
      const name = calleeName(expr.callee);
      if (name.startsWith("input")) v.onInput?.(expr, name);
      v.onCall?.(expr, name);
      for (const arg of expr.args) walkExpr(arg.value, v);
      break;
    }
    case "member":
      v.onMember?.(expr);
      walkExpr(expr.object, v);
      break;
    case "bin":
      walkExpr(expr.left, v);
      walkExpr(expr.right, v);
      break;
    case "un":
      walkExpr(expr.arg, v);
      break;
    case "ternary":
      walkExpr(expr.cond, v);
      walkExpr(expr.then, v);
      walkExpr(expr.else, v);
      break;
    case "history":
      walkExpr(expr.object, v);
      walkExpr(expr.offset, v);
      break;
    case "array":
    case "tuple":
      expr.items.forEach((item) => walkExpr(item, v));
      break;
    case "if":
      walkExpr(expr.cond, v);
      expr.then.forEach((s2) => walkStatement(s2, v));
      expr.else?.forEach((s2) => walkStatement(s2, v));
      break;
    case "switch":
      if (expr.subject) walkExpr(expr.subject, v);
      for (const c of expr.cases) {
        if (c.test) walkExpr(c.test, v);
        if (c.exprBody) walkExpr(c.exprBody, v);
        c.body.forEach((s2) => walkStatement(s2, v));
      }
      break;
    case "lambda":
      if (expr.exprBody) walkExpr(expr.exprBody, v);
      expr.body.forEach((s2) => walkStatement(s2, v));
      break;
    default:
      break;
  }
}
function assertSupportedVersion(script) {
  if (script.version === null) return;
  if (!Number.isInteger(script.version) || script.version < 1 || script.version > 6) {
    throw new PineSyntaxError(`Unsupported Pine version ${script.version}; the language defines versions 1 to 6`, 1, 1, "UNSUPPORTED");
  }
}

// src/runtime/strategy.ts
var MAX_ORDERS = 9e3;
var DEFAULT_BROKER_OPTIONS = {
  initialCapital: 1e6,
  commissionType: "percent",
  commissionValue: 0,
  slippage: 0,
  qtyType: "fixed",
  qtyValue: 1,
  processOnClose: false,
  pyramiding: 0
};
var Broker = class {
  opts;
  pending = [];
  lots = [];
  position = 0;
  avgPrice = 0;
  realized = 0;
  commissionPaid = 0;
  grossProfit = 0;
  grossLoss = 0;
  wins = 0;
  losses = 0;
  even = 0;
  maxDrawdown = 0;
  maxRunup = 0;
  peakEquity;
  troughEquity;
  equity = 0;
  openPnl = 0;
  lastClose = 0;
  fills = [];
  closedTrades = [];
  /**
   * Pine v6 keeps at most 9000 orders: anything older is trimmed away and its trade
   * records read as `na`. v5 instead aborted the whole run, which this engine never did,
   * so the cap is applied on the stored order/fill log for both versions.
   */
  orderCount = 0;
  trimmedOrders = 0;
  /** Number of closed trades dropped from the front of `closedTrades` by trimming. */
  trimmedTrades = 0;
  /** Pine risk settings, set by the declaration and the `strategy.risk.*` calls. */
  pyramiding = 0;
  maxPositionSize = null;
  allowedDirection = "all";
  maxIntradayLoss = null;
  /** `strategy.risk.max_drawdown(value, type)`: halt when equity falls this far. */
  maxDrawdownLimit = null;
  maxDrawdownIsPercent = false;
  /** `strategy.risk.max_cons_loss_days(n)`: stop after n losing sessions in a row. */
  maxConsLossDays = null;
  /** `strategy.risk.max_intraday_filled_orders(n)`: cap fills per session. */
  maxIntradayFilledOrders = null;
  dayStartEquity = null;
  currentDay = -1;
  dayStartRealized = 0;
  losingDaysInARow = 0;
  fillsToday = 0;
  /** Largest absolute position reached, per side (`strategy.max_contracts_held_*`). */
  maxContractsAll = 0;
  maxContractsLong = 0;
  maxContractsShort = 0;
  openTradeMeta = /* @__PURE__ */ new Map();
  tradeSeq = 0;
  orderSeq = 0;
  constructor(opts = {}) {
    this.opts = { ...DEFAULT_BROKER_OPTIONS, ...opts };
    this.peakEquity = this.opts.initialCapital;
    this.troughEquity = this.opts.initialCapital;
    this.equity = this.opts.initialCapital;
    this.pyramiding = this.opts.pyramiding ?? 0;
  }
  // ------------------------------------------------------------------ intents
  entry(req) {
    this.pending.push({ ...req, kind: "entry", placedBar: this.currentBar });
  }
  order(req) {
    this.pending.push({ ...req, kind: "order", placedBar: this.currentBar });
  }
  /**
   * `strategy.close(entryId)` / `strategy.close_all()`: the argument names the *entry* the
   * call closes, while the resulting exit order carries its own label (`Close` / `Close All`).
   */
  close(entryId, comment, qty = null, qtyPercent = null, label = "Close") {
    if (this.position === 0) return;
    this.pending.push({
      kind: "close",
      direction: this.position > 0 ? -1 : 1,
      id: label,
      qty,
      limit: null,
      stop: null,
      comment,
      fromEntry: entryId ?? void 0,
      mintick: 1,
      qtyPercent,
      placedBar: this.currentBar
    });
  }
  // ------------------------------------------------------------- trailing exits
  trailing = [];
  /** Register (or replace) the trailing bracket created by `strategy.exit()`. */
  setTrailing(cfg) {
    this.trailing = this.trailing.filter((t) => t.id !== cfg.id);
    this.trailing.push(cfg);
  }
  clearTrailing(id) {
    this.trailing = id === void 0 ? [] : this.trailing.filter((t) => t.id !== id);
  }
  // ------------------------------------------------- deferred (pre-fill) brackets
  deferred = [];
  /**
   * Remember a `strategy.exit()` bracket whose relative levels cannot be priced yet
   * because its entry has not filled. `armDeferred` turns it into a working OCA order
   * the moment the entry fills, off the actual fill price.
   */
  deferExit(cfg) {
    this.deferred = this.deferred.filter((d) => d.id !== cfg.id);
    this.deferred.push(cfg);
  }
  /** Called after any entry fill: price the pending brackets off the new entry price. */
  armDeferred(entryPrice, entryId) {
    if (this.deferred.length === 0 || this.position === 0) return;
    const closingLong = this.position > 0;
    const still = [];
    for (const d of this.deferred) {
      const matchesSide = closingLong ? d.direction < 0 : d.direction > 0;
      const matchesEntry = d.fromEntry === void 0 || d.fromEntry === entryId;
      if (!matchesSide || !matchesEntry) {
        still.push(d);
        continue;
      }
      const limit = d.profitTicks !== null ? closingLong ? entryPrice + d.profitTicks * d.tick : entryPrice - d.profitTicks * d.tick : d.limitAbs;
      const stop = d.lossTicks !== null ? closingLong ? entryPrice - d.lossTicks * d.tick : entryPrice + d.lossTicks * d.tick : d.stopAbs;
      if (limit === null && stop === null) continue;
      this.pending.push({
        kind: "entry",
        direction: d.direction,
        id: d.id,
        qty: d.qty,
        limit,
        stop,
        oco: limit !== null && stop !== null,
        ...d.comment !== void 0 ? { comment: d.comment } : {},
        ...d.fromEntry !== void 0 ? { fromEntry: d.fromEntry } : {},
        mintick: d.tick,
        ...d.qtyPercent !== null ? { qtyPercent: d.qtyPercent } : {},
        placedBar: this.currentBar
      });
    }
    this.deferred = still;
  }
  /** `strategy.cancel_all()` drops armed brackets along with the working orders. */
  clearDeferred() {
    this.deferred = [];
  }
  /**
   * Evaluate the trailing brackets against a bar. Activation and the trailing stop are
   * tick based, like Pine's `trail_points` / `trail_offset`.
   */
  checkTrailing(bar, barIndex) {
    if (this.trailing.length === 0 || this.position === 0) return;
    const open2 = [];
    for (const cfg of this.trailing) {
      if (Math.sign(cfg.direction) === Math.sign(this.position)) {
        continue;
      }
      const long = cfg.direction < 0 ? this.position > 0 : this.position < 0;
      const extreme = long ? bar.high : bar.low;
      const adverse = long ? bar.low : bar.high;
      const wasActive = cfg.active;
      if (!cfg.active) {
        const entry = this.avgPrice;
        const reachedByProfit = cfg.points !== null && entry > 0 ? (long ? extreme - entry : entry - extreme) >= cfg.points * cfg.tick : false;
        const reachedByPrice = cfg.price !== null && (long ? extreme >= cfg.price : extreme <= cfg.price);
        if (reachedByProfit || reachedByPrice) {
          cfg.active = true;
          cfg.best = extreme;
        }
      }
      if (cfg.active && cfg.offset !== null) {
        cfg.best = long ? Math.max(cfg.best ?? extreme, extreme) : Math.min(cfg.best ?? extreme, extreme);
        const level = long ? cfg.best - cfg.offset * cfg.tick : cfg.best + cfg.offset * cfg.tick;
        const hit = long ? adverse <= level : adverse >= level;
        if (hit) {
          const price = wasActive ? long ? Math.min(level, bar.open) : Math.max(level, bar.open) : level;
          this.execute(
            {
              kind: "close",
              direction: long ? -1 : 1,
              id: cfg.id,
              qty: cfg.qty,
              qtyPercent: cfg.qtyPercent,
              limit: null,
              stop: null,
              mintick: cfg.tick,
              placedBar: barIndex
            },
            price,
            bar,
            barIndex
          );
          if (this.position !== 0) open2.push(cfg);
          continue;
        }
      }
      open2.push(cfg);
    }
    this.trailing = open2;
  }
  cancelAll() {
    this.pending.length = 0;
    this.deferred = [];
  }
  /**
   * The newest pending entry, used by `strategy.exit()` when the bracket is placed on the
   * same bar as the entry (Pine evaluates the exit against the order, not the position).
   */
  pendingEntry(fromEntry) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const order = this.pending[i];
      if (!order) continue;
      if (fromEntry !== void 0 && order.id !== fromEntry && order.fromEntry !== fromEntry) continue;
      return { direction: order.direction, qty: order.qty ?? 1 };
    }
    return null;
  }
  /** `strategy.cancel(id)` — drop the pending orders placed under that id. */
  cancel(id) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]?.id === id) this.pending.splice(i, 1);
    }
  }
  currentBar = 0;
  // ------------------------------------------------------------- bar lifecycle
  /** Called when a new bar opens, before the script runs for it. */
  onBarOpen(bar, barIndex) {
    this.tradingHalted(bar);
    this.currentBar = barIndex;
    const still = [];
    for (const order of this.pending) {
      if (order.placedBar >= barIndex && !this.opts.processOnClose) {
        still.push(order);
        continue;
      }
      const filled = this.tryFill(order, bar, barIndex, "open");
      if (!filled) still.push(order);
    }
    this.pending = still;
    this.checkTrailing(bar, barIndex);
    this.lastClose = bar.close;
    this.markToMarket(bar.close);
  }
  /**
   * Called after the script ran for a bar. With `process_orders_on_close` market orders
   * placed this bar fill at this bar's close, which is what Pine's broker emulator does.
   */
  onBarClose(bar, barIndex) {
    if (this.opts.processOnClose) {
      const still = [];
      for (const order of this.pending) {
        if (order.limit !== null || order.stop !== null) {
          still.push(order);
          continue;
        }
        if (!this.tryFill(order, bar, barIndex, "close")) still.push(order);
      }
      this.pending = still;
    }
    this.checkTrailing(bar, barIndex);
    this.lastClose = bar.close;
    this.trackPositionExtremes();
    this.markToMarket(bar.close);
  }
  /**
   * Session bookkeeping: rolls the per-day counters over when the calendar day changes and
   * reports whether any `strategy.risk.*` rule currently forbids new entries.
   */
  tradingHalted(bar) {
    const day = Math.floor(bar.time / 864e5);
    if (day !== this.currentDay) {
      if (this.currentDay >= 0 && this.maxConsLossDays !== null) {
        const dayPnl = this.realized - this.dayStartRealized;
        this.losingDaysInARow = dayPnl < 0 ? this.losingDaysInARow + 1 : 0;
      }
      this.currentDay = day;
      this.dayStartEquity = this.equity;
      this.dayStartRealized = this.realized;
      this.fillsToday = 0;
    }
    if (this.dayStartEquity === null) this.dayStartEquity = this.equity;
    if (this.maxIntradayLoss !== null && this.equity - this.dayStartEquity <= -Math.abs(this.maxIntradayLoss)) {
      return true;
    }
    if (this.maxDrawdownLimit !== null) {
      const limit = this.maxDrawdownIsPercent ? Math.abs(this.maxDrawdownLimit) / 100 * this.opts.initialCapital : Math.abs(this.maxDrawdownLimit);
      if (this.peakEquity - this.equity >= limit) return true;
    }
    if (this.maxConsLossDays !== null && this.losingDaysInARow >= this.maxConsLossDays) return true;
    if (this.maxIntradayFilledOrders !== null && this.fillsToday >= this.maxIntradayFilledOrders) return true;
    return false;
  }
  trackPositionExtremes() {
    const size = Math.abs(this.position);
    if (size > this.maxContractsAll) this.maxContractsAll = size;
    if (this.position > 0 && this.position > this.maxContractsLong) this.maxContractsLong = this.position;
    if (this.position < 0 && size > this.maxContractsShort) this.maxContractsShort = size;
  }
  /** `strategy.position_entry_name` — the id of the entry that opened the position. */
  positionEntryName() {
    const first = this.lots[0];
    if (!first) return null;
    const meta = this.openTradeMeta.get(first.tradeId);
    return meta?.entry.id ?? first.entryId;
  }
  /** Notional margin required to hold the current position (1× leverage). */
  marginLiquidationPrice() {
    if (this.position === 0 || this.avgPrice === 0) return null;
    if (this.position > 0) return this.avgPrice * (1 - this.equity / (this.avgPrice * this.position));
    return this.avgPrice * (1 + this.equity / (this.avgPrice * Math.abs(this.position)));
  }
  /** Strategy state summary at the current bar. */
  state() {
    return {
      position: this.position,
      avgPrice: this.avgPrice,
      equity: this.equity,
      openPnl: this.openPnl,
      netPnl: round2(this.grossProfit + this.grossLoss - this.commissionPaid),
      grossProfit: this.grossProfit,
      grossLoss: this.grossLoss,
      wins: this.wins,
      losses: this.losses,
      even: this.even,
      maxDrawdown: this.maxDrawdown,
      maxRunup: this.maxRunup,
      initialCapital: this.opts.initialCapital
    };
  }
  trades() {
    const out = this.closedTrades.slice();
    for (const lot of this.lots) {
      const meta = this.openTradeMeta.get(lot.tradeId);
      const entryPrice = meta?.entry.price ?? lot.price;
      const favorable = lot.side === "long" ? (meta?.maxPrice ?? lot.price) - entryPrice : entryPrice - (meta?.minPrice ?? lot.price);
      const adverse = lot.side === "long" ? (meta?.minPrice ?? lot.price) - entryPrice : entryPrice - (meta?.maxPrice ?? lot.price);
      out.push({
        id: lot.tradeId,
        side: lot.side,
        qty: Math.abs(lot.qty),
        entry: meta?.entry ?? { id: lot.entryId, time: lot.time, price: lot.price },
        open: true,
        commission: round2(lot.commission),
        entryBarIndex: meta?.entryBarIndex ?? 0,
        maxRunup: round2(Math.max(0, favorable * Math.abs(lot.qty))),
        maxDrawdown: round2(Math.max(0, -adverse * Math.abs(lot.qty))),
        maxRunupPercent: entryPrice > 0 ? round2(Math.max(0, favorable) / entryPrice * 100) : 0,
        maxDrawdownPercent: entryPrice > 0 ? round2(Math.max(0, -adverse) / entryPrice * 100) : 0
      });
    }
    return out;
  }
  // ------------------------------------------------------------------ internals
  /** Track per-open-trade price extremes so `strategy.closedtrades.max_runup()` is real. */
  updateExcursions(price) {
    for (const meta of this.openTradeMeta.values()) {
      if (price > meta.maxPrice) meta.maxPrice = price;
      if (price < meta.minPrice) meta.minPrice = price;
    }
  }
  markToMarket(price) {
    this.updateExcursions(price);
    this.lastClose = price;
    this.openPnl = this.position === 0 ? 0 : round2((price - this.avgPrice) * this.position);
    this.equity = round2(this.opts.initialCapital + this.realized + this.openPnl);
    if (this.equity > this.peakEquity) this.peakEquity = this.equity;
    if (this.equity < this.troughEquity) this.troughEquity = this.equity;
    const runup = this.equity - this.troughEquity;
    if (runup > this.maxRunup) this.maxRunup = runup;
    const dd = this.peakEquity - this.equity;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;
  }
  tryFill(order, bar, barIndex, trigger) {
    const slip = this.opts.slippage;
    if (this.position === 0 && (order.oco || order.fromEntry !== void 0)) return true;
    if (order.limit !== null || order.stop !== null) {
      if (order.oco && order.limit !== null && order.stop !== null) {
        const limitHit = order.direction > 0 ? bar.low <= order.limit : bar.high >= order.limit;
        const stopHit = order.direction > 0 ? bar.high >= order.stop : bar.low <= order.stop;
        const limitPrice = order.direction > 0 ? Math.min(order.limit, bar.open) : Math.max(order.limit, bar.open);
        const stopPrice = order.direction > 0 ? Math.max(order.stop, bar.open) : Math.min(order.stop, bar.open);
        let price2 = null;
        if (limitHit && stopHit) {
          price2 = Math.abs(order.limit - bar.open) <= Math.abs(order.stop - bar.open) ? limitPrice : stopPrice;
        } else if (limitHit) {
          price2 = limitPrice;
        } else if (stopHit) {
          price2 = stopPrice;
        }
        if (price2 === null) return false;
        this.execute(order, price2 + order.direction * slip, bar, barIndex);
        return true;
      }
      let price = null;
      if (order.limit !== null) {
        const level = order.limit;
        if (order.direction > 0 ? bar.low <= level : bar.high >= level) {
          price = order.direction > 0 ? Math.min(level, bar.open) : Math.max(level, bar.open);
        }
      } else if (order.stop !== null) {
        const level = order.stop;
        if (order.direction > 0 ? bar.high >= level : bar.low <= level) {
          price = order.direction > 0 ? Math.max(level, bar.open) : Math.min(level, bar.open);
        }
      }
      if (price === null) return false;
      this.execute(order, price + order.direction * slip, bar, barIndex);
      return true;
    }
    if (trigger === "close") {
      this.execute(order, bar.close + order.direction * slip, bar, barIndex);
      return true;
    }
    if (trigger === "open") {
      this.execute(order, bar.open + order.direction * slip, bar, barIndex);
      return true;
    }
    return false;
  }
  resolveQty(order, price) {
    if (order.kind === "close") {
      const base3 = Math.abs(this.position);
      if (order.qty !== null) return Math.min(base3, Math.abs(order.qty));
      if (order.qtyPercent !== null && order.qtyPercent !== void 0) {
        return Math.min(base3, base3 * Math.abs(order.qtyPercent) / 100);
      }
      return base3;
    }
    const cap = (qty) => this.maxPositionSize === null ? qty : Math.min(qty, Math.abs(this.maxPositionSize));
    if (order.qty !== null) return cap(Math.abs(order.qty));
    switch (this.opts.qtyType) {
      case "percent_of_equity": {
        if (price <= 0) return 0;
        return cap(Math.max(0, Math.floor(this.equity * (this.opts.qtyValue / 100) / price)));
      }
      case "cash": {
        if (price <= 0) return 0;
        return cap(Math.max(0, Math.floor(this.opts.qtyValue / price)));
      }
      case "shares":
      case "fixed":
      default:
        return cap(Math.abs(this.opts.qtyValue));
    }
  }
  commission(price, qty) {
    switch (this.opts.commissionType) {
      case "cash_per_contract":
        return this.opts.commissionValue * qty;
      case "cash_per_order":
        return this.opts.commissionValue;
      case "percent":
      default:
        return this.opts.commissionValue / 100 * price * qty;
    }
  }
  execute(order, price, bar, barIndex) {
    const qty = this.resolveQty(order, price);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const direction = order.kind === "close" ? this.position > 0 ? -1 : 1 : Math.sign(order.direction) || 1;
    const signed = direction * qty;
    const fee = this.commission(price, qty);
    this.commissionPaid += fee;
    this.realized -= fee;
    const label = order.comment ?? order.id;
    if (this.position !== 0 && Math.sign(signed) !== Math.sign(this.position)) {
      let remaining = Math.min(qty, Math.abs(this.position));
      const closingAll = remaining >= Math.abs(this.position);
      while (remaining > 1e-12 && this.lots.length > 0) {
        const lot = this.lots[0];
        const lotQty = Math.abs(lot.qty);
        const used = Math.min(remaining, lotQty);
        const pnl = lot.side === "long" ? (price - lot.price) * used : (lot.price - price) * used;
        this.realized += pnl;
        if (pnl > 0) this.grossProfit += pnl;
        else if (pnl < 0) this.grossLoss += pnl;
        const lotCommission = lot.commission * (used / lotQty);
        this.closeTrade(lot, used, price, bar.time, order.id, order.comment, pnl, lotCommission + fee * (used / qty));
        remaining -= used;
        if (used >= lotQty - 1e-12) this.lots.shift();
        else lot.qty = lot.qty - Math.sign(lot.qty) * used;
        if (!closingAll) break;
      }
      this.position += signed;
      if (Math.abs(this.position) < 1e-9) {
        this.position = 0;
        this.avgPrice = 0;
        this.pending = this.pending.filter((o) => !o.oco && o.fromEntry === void 0);
        this.deferred = [];
      } else if (Math.sign(this.position) === Math.sign(signed)) {
        this.avgPrice = price;
      }
      this.fillsToday++;
      this.orderCount++;
      this.fills.push({
        time: bar.time,
        price,
        side: direction > 0 ? "buy" : "sell",
        kind: "exit",
        label: label || void 0,
        qty
      });
    } else {
      const side = signed > 0 ? "long" : "short";
      if (this.allowedDirection !== "all" && this.allowedDirection !== side) return;
      const openSameSide = this.lots.filter((lot2) => lot2.side === side).length;
      if (openSameSide >= this.pyramiding + 1) return;
      if (this.tradingHalted(bar)) return;
      const tradeId = `${side}-${++this.tradeSeq}`;
      const lot = {
        tradeId,
        qty: signed,
        price,
        time: bar.time,
        side,
        entryId: order.id,
        commission: fee,
        ...order.comment !== void 0 ? { comment: order.comment } : {}
      };
      this.lots.push(lot);
      this.openTradeMeta.set(tradeId, {
        entry: { id: order.id, time: bar.time, price, ...order.comment ? { comment: order.comment } : {} },
        side,
        qty,
        commission: fee,
        entryBarIndex: barIndex,
        maxPrice: price,
        minPrice: price
      });
      if (this.position === 0) {
        this.avgPrice = price;
        this.position = signed;
      } else {
        this.avgPrice = (this.avgPrice * Math.abs(this.position) + price * qty) / (Math.abs(this.position) + qty);
        this.position += signed;
      }
      this.armDeferred(price, order.id);
      this.fillsToday++;
      this.orderCount++;
      this.fills.push({
        time: bar.time,
        price,
        side: direction > 0 ? "buy" : "sell",
        kind: "entry",
        label: label || void 0,
        qty,
        tradeId
      });
    }
    this.trimOrders();
    this.markToMarket(bar.close);
  }
  /**
   * Pine v6 keeps the 9000 most recent orders and trims the rest (v5 raised an error
   * instead). Trimming here drops the oldest fills and the closed trades those fills
   * finished, so `strategy.closedtrades.first_index` becomes `> 0`.
   */
  trimOrders() {
    const excess = this.orderCount - MAX_ORDERS;
    if (excess <= this.trimmedOrders) return;
    while (this.trimmedOrders < excess && this.fills.length > 0) {
      const oldest = this.fills.shift();
      this.trimmedOrders++;
      if (!oldest) break;
      while (this.closedTrades.length > 0 && (this.closedTrades[0]?.exit?.time ?? 0) <= oldest.time) {
        this.closedTrades.shift();
        this.trimmedTrades++;
      }
    }
  }
  closeTrade(lot, qty, price, time, exitId, exitComment, pnl, commission) {
    const meta = this.openTradeMeta.get(lot.tradeId);
    const entry = meta?.entry ?? { id: lot.entryId, time: lot.time, price: lot.price };
    const entryPrice = entry.price;
    const maxPrice = meta ? Math.max(meta.maxPrice, price) : price;
    const minPrice = meta ? Math.min(meta.minPrice, price) : price;
    const favorable = lot.side === "long" ? maxPrice - entryPrice : entryPrice - minPrice;
    const adverse = lot.side === "long" ? minPrice - entryPrice : entryPrice - maxPrice;
    const notional = entryPrice * qty;
    const trade = {
      id: lot.tradeId,
      side: lot.side,
      qty,
      entry,
      exit: { id: exitId, time, price, ...exitComment ? { comment: exitComment } : {} },
      open: false,
      pnl: round2(pnl),
      commission: round2(commission),
      entryBarIndex: meta?.entryBarIndex ?? 0,
      exitBarIndex: this.currentBar,
      maxRunup: round2(Math.max(0, favorable * qty)),
      maxDrawdown: round2(Math.max(0, -adverse * qty)),
      maxRunupPercent: notional > 0 ? round2(Math.max(0, favorable) / entryPrice * 100) : 0,
      maxDrawdownPercent: notional > 0 ? round2(Math.max(0, -adverse) / entryPrice * 100) : 0
    };
    this.closedTrades.push(trade);
    if (pnl > 0) this.wins++;
    else if (pnl < 0) this.losses++;
    else this.even++;
    if (Math.abs(lot.qty) <= qty + 1e-12) this.openTradeMeta.delete(lot.tradeId);
  }
};
function round2(x) {
  return Math.round(x * 100) / 100;
}

// src/runtime/plotting.ts
var PlotSink = class {
  lines = /* @__PURE__ */ new Map();
  markers = /* @__PURE__ */ new Map();
  hlines = /* @__PURE__ */ new Map();
  fills = /* @__PURE__ */ new Map();
  backgrounds = /* @__PURE__ */ new Map();
  candles = /* @__PURE__ */ new Map();
  barColors = [];
  ensureLine(callId, init) {
    let rec = this.lines.get(callId);
    if (!rec) {
      rec = { callId, ...init, values: [], colors: [] };
      this.lines.set(callId, rec);
    }
    return rec;
  }
  ensureMarkers(callId, title) {
    let rec = this.markers.get(callId);
    if (!rec) {
      rec = { callId, title, points: [] };
      this.markers.set(callId, rec);
    }
    return rec;
  }
  ensureBackground(callId, title) {
    let rec = this.backgrounds.get(callId);
    if (!rec) {
      rec = { callId, title, colors: [] };
      this.backgrounds.set(callId, rec);
    }
    return rec;
  }
  ensureCandles(callId, title, kind) {
    let rec = this.candles.get(callId);
    if (!rec) {
      rec = { callId, title, kind, points: [] };
      this.candles.set(callId, rec);
    }
    return rec;
  }
  ensureFill(callId, fromId, toId, color) {
    let rec = this.fills.get(callId);
    if (!rec) {
      rec = { callId, fromId, toId, color, colors: [] };
      this.fills.set(callId, rec);
    }
    return rec;
  }
};
function slotCount(bars, offset) {
  return offset > 0 ? bars + offset : bars;
}
function seriesId(instanceId, scope, title) {
  return `${instanceId}:${scope}:${slug(title)}`;
}
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "series";
}
function buildModel(sink, bars, opts) {
  const paneId = opts.paneId ?? (opts.meta.overlay ? "price" : "pane");
  const step = bars.length > 1 ? bars[1].time - bars[0].time : 6e4;
  const series = [];
  const lineIds = /* @__PURE__ */ new Map();
  for (const rec of sink.lines.values()) {
    if (!rec.visible) continue;
    const offset = rec.offset;
    const total = slotCount(bars.length, offset);
    const points = [];
    for (let i = 0; i < total; i++) {
      const src = i - offset;
      const value = src >= 0 && src < rec.values.length ? rec.values[src] ?? null : null;
      const color = src >= 0 && src < rec.colors.length ? rec.colors[src] : null;
      const time = i < bars.length ? bars[i].time : bars[bars.length - 1].time + step * (i - bars.length + 1);
      const point = { time, value };
      if (color) point.color = color;
      points.push(point);
    }
    const id = seriesId(opts.instanceId, "plot", rec.title);
    lineIds.set(rec.callId, id);
    const style = {
      color: rec.color,
      width: rec.width,
      lineStyle: rec.lineStyle
    };
    if (rec.base !== void 0) style.base = rec.base;
    series.push({ id, title: rec.title, paneId, kind: rec.kind, points, style });
  }
  for (const rec of sink.markers.values()) {
    const markers = [];
    for (const m of rec.points) if (m) markers.push(m);
    series.push({
      id: seriesId(opts.instanceId, "marker", rec.title),
      title: rec.title,
      paneId,
      kind: "markers",
      markers
    });
  }
  const candleSeries = [];
  for (const rec of sink.candles.values()) {
    const candles = [];
    rec.points.forEach((candle, i) => {
      const time = bars[i]?.time;
      if (!candle || time === void 0) return;
      candles.push({ time, ...candle });
    });
    candleSeries.push({
      id: seriesId(opts.instanceId, "candle", rec.title),
      title: rec.title,
      paneId,
      kind: rec.kind,
      candles
    });
  }
  const fills = [];
  for (const rec of sink.fills.values()) {
    const fromSeriesId = lineIds.get(rec.fromId);
    const toSeriesId = lineIds.get(rec.toId);
    if (!fromSeriesId || !toSeriesId) continue;
    const fill = { id: `${opts.instanceId}:fill:${rec.callId}`, paneId, fromSeriesId, toSeriesId, color: rec.color };
    if (rec.colors.some((c) => c !== null)) fill.colors = rec.colors;
    fills.push(fill);
  }
  const backgrounds = [];
  for (const rec of sink.backgrounds.values()) {
    for (let i = 0; i < rec.colors.length; i++) {
      const color = rec.colors[i];
      if (!color) continue;
      const from = bars[i]?.time;
      const to = bars[i + 1]?.time ?? bars[bars.length - 1]?.time;
      if (from === void 0 || to === void 0) continue;
      backgrounds.push({ id: `${opts.instanceId}:bg:${rec.callId}:${i}`, paneId, from, to: i + 1 < bars.length ? to : to + step, color });
    }
  }
  const priceLines = [];
  for (const rec of sink.hlines.values()) {
    priceLines.push({
      id: `${opts.instanceId}:hline:${rec.callId}`,
      paneId,
      price: rec.price,
      color: rec.color,
      lineStyle: rec.lineStyle,
      width: rec.width,
      title: rec.title
    });
  }
  const model = {
    id: opts.instanceId,
    title: opts.meta.title,
    overlay: opts.meta.overlay,
    paneHint: opts.meta.overlay ? "price" : "new",
    series,
    ...candleSeries.length > 0 ? { candleSeries } : {},
    fills,
    backgrounds,
    priceLines,
    inputs: opts.inputs,
    inputValues: opts.inputValues
  };
  if (opts.meta.shorttitle) model.shorttitle = opts.meta.shorttitle;
  if (opts.meta.precision !== void 0) {
  }
  if (sink.barColors.some((c) => c !== null)) {
    model.barColors = bars.map((b, i) => ({ time: b.time, color: sink.barColors[i] ?? "" })).filter((c) => c.color !== "");
  }
  if (opts.trades && opts.trades.length > 0) model.trades = opts.trades;
  if (opts.drawings) {
    const store2 = opts.drawings;
    const lines = store2.live("line");
    const boxes = store2.live("box");
    const labels = store2.live("label");
    const polylines = store2.live("polyline");
    const linefills = store2.live("linefill");
    const tables = store2.live("table");
    if (lines.length > 0) model.lines = lines.map((o) => store2.lineModel(o, paneId));
    if (boxes.length > 0) model.boxes = boxes.map((o) => store2.boxModel(o, paneId));
    if (labels.length > 0) model.labels = labels.map((o) => store2.labelModel(o, paneId));
    if (tables.length > 0) model.tables = tables.map((o) => store2.tableModel(o, paneId));
    if (polylines.length > 0) {
      model.polylines = polylines.map((o) => ({
        id: o.id,
        paneId,
        points: o.points,
        curved: o.curved,
        closed: o.closed,
        lineWidth: o.lineWidth,
        lineStyle: o.lineStyle,
        arrowLeft: false,
        arrowRight: false,
        ...o.lineColor ? { lineColor: o.lineColor } : {},
        ...o.fillColor ? { fillColor: o.fillColor } : {}
      }));
    }
    if (linefills.length > 0) {
      const byId = new Map(lines.map((o) => [o.id, o]));
      model.linefills = linefills.map((o) => {
        const l1 = byId.get(o.line1);
        const l2 = byId.get(o.line2);
        if (!l1 || !l2) return null;
        return {
          id: o.id,
          paneId,
          line1: store2.lineModel(l1, paneId),
          line2: store2.lineModel(l2, paneId),
          ...o.color ? { color: o.color } : {}
        };
      }).filter((x) => x !== null);
    }
  }
  if (opts.props) {
    model.props = opts.props;
    model.propValues = opts.propValues ?? {};
  }
  return model;
}

// src/runtime/drawings.ts
var DrawingStore = class {
  nextId = 0;
  objects = /* @__PURE__ */ new Map();
  /** Insertion order per kind, so `.all` lists objects in creation order. */
  order = {};
  /** Create and register a drawing object; the caller narrows the returned record. */
  create(object) {
    const id = `${object.kind}:${this.nextId++}`;
    const record = { ...object, id };
    this.objects.set(id, record);
    (this.order[object.kind] ??= []).push(id);
    return record;
  }
  get(id) {
    return this.objects.get(id);
  }
  delete(id) {
    const obj = this.objects.get(id);
    if (!obj || obj.kind === "point") return;
    obj.deleted = true;
  }
  /** Live ids of one kind, in creation order. */
  ids(kind) {
    return (this.order[kind] ?? []).filter((id) => {
      const obj = this.objects.get(id);
      return obj && !obj.deleted;
    });
  }
  live(kind) {
    return this.ids(kind).map((id) => this.objects.get(id)).filter(Boolean);
  }
  /** Convert one line object into the host vocabulary. */
  lineModel(obj, paneId) {
    const line = {
      id: obj.id,
      paneId,
      xloc: obj.xloc,
      x1: obj.x1,
      y1: obj.y1,
      x2: obj.x2,
      y2: obj.y2,
      extend: obj.extend,
      invisible: obj.color === null,
      width: obj.width,
      style: obj.style,
      arrowLeft: obj.arrowLeft,
      arrowRight: obj.arrowRight
    };
    if (obj.color !== null) line.color = obj.color;
    return line;
  }
  labelModel(obj, paneId) {
    const label = {
      id: obj.id,
      paneId,
      xloc: obj.xloc,
      x: obj.x,
      y: obj.y,
      yloc: obj.yloc,
      style: obj.style,
      size: obj.size,
      textAlign: obj.textAlign,
      fontFamily: obj.fontFamily
    };
    if (obj.text !== "") label.text = obj.text;
    if (obj.color !== null) label.color = obj.color;
    else label.noFill = true;
    if (obj.textColor !== null) label.textColor = obj.textColor;
    if (obj.tooltip !== null) label.tooltip = obj.tooltip;
    if (obj.bold) label.bold = true;
    if (obj.italic) label.italic = true;
    return label;
  }
  boxModel(obj, paneId) {
    const box = {
      id: obj.id,
      paneId,
      xloc: obj.xloc,
      left: obj.left,
      top: obj.top,
      right: obj.right,
      bottom: obj.bottom,
      extend: obj.extend,
      borderWidth: obj.borderWidth,
      borderStyle: obj.borderStyle,
      textSize: obj.textSize,
      hAlign: obj.hAlign,
      vAlign: obj.vAlign,
      wrap: obj.wrap,
      fontFamily: obj.fontFamily,
      bold: obj.bold,
      italic: obj.italic
    };
    if (obj.bgColor !== null) box.bgColor = obj.bgColor;
    if (obj.borderColor !== null) box.borderColor = obj.borderColor;
    if (obj.text !== null && obj.text !== "") box.text = obj.text;
    if (obj.textColor !== null) box.textColor = obj.textColor;
    return box;
  }
  tableModel(obj, paneId) {
    const table = {
      id: obj.id,
      paneId,
      position: obj.position,
      columns: obj.columns,
      rows: obj.rows,
      frameWidth: obj.frameWidth,
      borderWidth: obj.borderWidth,
      cells: obj.cells,
      merges: obj.merges
    };
    if (obj.bgColor !== null) table.bgColor = obj.bgColor;
    if (obj.frameColor !== null) table.frameColor = obj.frameColor;
    if (obj.borderColor !== null) table.borderColor = obj.borderColor;
    return table;
  }
};

// src/runtime/series.ts
var Slot = class {
  /** Value produced on the current bar. */
  current = null;
  /** Committed values, oldest first; `history[history.length - 1]` is the previous bar. */
  history = [];
  /** `var`/`varip` declarations survive the per-bar scope reset. */
  persistent;
  constructor(persistent = false) {
    this.persistent = persistent;
  }
  get(offset) {
    if (!Number.isFinite(offset)) return null;
    const o = Math.trunc(offset);
    if (o === 0) return this.current;
    if (o < 0) return null;
    const idx = this.history.length - o;
    if (idx < 0) return null;
    return this.history[idx] ?? null;
  }
  /** Advance the series by one bar. */
  commit() {
    this.history.push(this.current);
  }
  view() {
    return {
      get: (offset) => this.get(offset),
      known: this.history.length + 1
    };
  }
};
function constantSeries(value) {
  return { get: () => value, known: Number.POSITIVE_INFINITY };
}
function recordedSeries(values, barIndex) {
  let known = 0;
  for (let i = 0; i <= barIndex && i < values.length; i++) if (values[i] !== void 0) known++;
  return {
    get: (offset) => {
      if (offset === 0) return values[barIndex] ?? null;
      const idx = barIndex - Math.trunc(offset);
      if (idx < 0) return null;
      return values[idx] ?? null;
    },
    known
  };
}
var PineTuple = class {
  __pine = "tuple";
  items;
  constructor(items) {
    this.items = items;
  }
  get length() {
    return this.items.length;
  }
};
var Frame = class {
  constructor(path) {
    this.path = path;
  }
  path;
  slots = /* @__PURE__ */ new Map();
  declare(name, persistent = false) {
    const slot = new Slot(persistent);
    this.slots.set(name, slot);
    return slot;
  }
  get(name) {
    return this.slots.get(name);
  }
};

// src/runtime/builtins/types.ts
function numArg(c, index, name) {
  return toNum(c.arg(index, name));
}
function intArg(c, index, name, def) {
  const v = numArg(c, index, name);
  if (v === null || !Number.isFinite(v)) return def;
  return Math.trunc(v);
}
function strArg(c, index, name, def) {
  const arg = c.argExpr(index, name);
  if (!arg) return def;
  const v = c.arg(index, name);
  if (v === null) return def;
  return toStr(v);
}
function boolArg(c, index, name, def) {
  const v = c.arg(index, name);
  if (v === null) return def;
  return Boolean(v);
}
function windowOf(view, len) {
  const out = [];
  for (let k = 0; k < len; k++) {
    const v = toNum(view.get(k));
    if (v === null || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}
function sum(values) {
  let s2 = 0;
  for (const v of values) s2 += v;
  return s2;
}
function mean(values) {
  return sum(values) / values.length;
}
function stdevOf(values, biased) {
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  const denom = biased ? values.length : values.length - 1;
  if (denom <= 0) return NaN;
  return Math.sqrt(acc / denom);
}

// src/runtime/builtins/ta.ts
function lengthArg(c, index) {
  const raw = c.arg(index, "length");
  const n2 = toNum(raw);
  return n2 === null || n2 <= 0 ? null : Math.round(n2);
}
function lenOf(c, index, name = "length", def = 14) {
  const v = intArg(c, index, name, def);
  return v > 0 ? v : 0;
}
function na() {
  return null;
}
function seriesArg(c, index, name = "source") {
  return c.argSeries(index, name);
}
function smaOf(view, len) {
  if (len <= 0) return null;
  const w = windowOf(view, len);
  if (!w) return null;
  return sum(w) / len;
}
function emaState() {
  return { prev: null, seedSum: 0, seedCount: 0, len: -1 };
}
function emaOf(view, len, st) {
  const v = toNum(view.get(0));
  if (v === null || !Number.isFinite(v)) return null;
  if (st.len !== len) {
    st.len = len;
    st.prev = null;
    st.seedSum = 0;
    st.seedCount = 0;
  }
  if (st.prev === null) {
    st.seedSum += v;
    st.seedCount++;
    if (st.seedCount >= len) {
      st.prev = st.seedSum / len;
      return st.prev;
    }
    return null;
  }
  const alpha = 2 / (len + 1);
  st.prev = alpha * v + (1 - alpha) * st.prev;
  return st.prev;
}
function rmaState() {
  return { prev: null, seedSum: 0, seedCount: 0, len: -1 };
}
function rmaOf(view, len, st) {
  const v = toNum(view.get(0));
  if (v === null || !Number.isFinite(v)) return null;
  if (st.len !== len) {
    st.len = len;
    st.prev = null;
    st.seedSum = 0;
    st.seedCount = 0;
  }
  if (st.prev === null) {
    st.seedSum += v;
    st.seedCount++;
    if (st.seedCount >= len) {
      st.prev = st.seedSum / len;
      return st.prev;
    }
    return null;
  }
  st.prev = (st.prev * (len - 1) + v) / len;
  return st.prev;
}
function wmaOf(view, len) {
  const w = windowOf(view, len);
  if (!w) return null;
  let acc = 0;
  let weight = 0;
  for (let i = 0; i < len; i++) {
    const v = w[i];
    const k = len - i;
    acc += v * k;
    weight += k;
  }
  return acc / weight;
}
function trOf(c) {
  const bar = c.rt.bar;
  if (!bar) return null;
  const prevClose = toNum(c.rt.seriesByName("close").get(1));
  const hl = bar.high - bar.low;
  if (prevClose === null) return hl;
  return Math.max(hl, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}
function registerTa(r) {
  r.set("ta.sma", (c) => {
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    return smaOf(seriesArg(c, 0), len);
  });
  r.set("ta.ema", (c) => {
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    const st = c.state(emaState);
    return emaOf(seriesArg(c, 0), len, st);
  });
  r.set("ta.rma", (c) => {
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    const st = c.state(rmaState);
    return rmaOf(seriesArg(c, 0), len, st);
  });
  r.set("ta.wma", (c) => {
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    return wmaOf(seriesArg(c, 0), len);
  });
  r.set("ta.vwma", (c) => {
    const len = lenOf(c, 1, "length");
    const src = seriesArg(c, 0);
    const vol = c.rt.seriesByName("volume");
    const sv = windowOf(src, len);
    const vv = windowOf(vol, len);
    if (!sv || !vv) return na();
    let num = 0;
    let den = 0;
    for (let i = 0; i < len; i++) {
      num += sv[i] * vv[i];
      den += vv[i];
    }
    return den === 0 ? na() : num / den;
  });
  r.set("ta.rsi", (c) => {
    const src = seriesArg(c, 0);
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    const st = c.state(() => ({ up: rmaState(), down: rmaState(), prev: null, len: -1 }));
    const v = toNum(src.get(0));
    if (v === null) return na();
    if (st.len !== len) {
      st.len = len;
      st.up = rmaState();
      st.down = rmaState();
      st.prev = null;
    }
    if (st.prev === null) {
      st.prev = v;
      return na();
    }
    const change = v - st.prev;
    st.prev = v;
    const up = rmaRaw(change > 0 ? change : 0, len, st.up);
    const down = rmaRaw(change < 0 ? -change : 0, len, st.down);
    if (up === null || down === null) return na();
    if (down === 0) return 100;
    const rs = up / down;
    return 100 - 100 / (1 + rs);
  });
  r.set("ta.tr", (c) => {
    const handleNa = c.argExpr(0, "handle_na");
    const value = trOf(c);
    void handleNa;
    return value;
  });
  r.set("ta.atr", (c) => {
    const len = lenOf(c, 0, "length");
    if (len <= 0) return na();
    const st = c.state(rmaState);
    const tr = trOf(c);
    if (tr === null) return na();
    return rmaRaw(tr, len, st);
  });
  r.set("ta.change", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = Math.max(0, intArg(c, 1, "length", 1));
    const now = toNum(src.get(0));
    const then = toNum(src.get(len));
    if (now === null || then === null) return na();
    return now - then;
  });
  r.set("ta.mom", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = Math.max(0, intArg(c, 1, "length", 10));
    const now = toNum(src.get(0));
    const then = toNum(src.get(len));
    if (now === null || then === null) return na();
    return now - then;
  });
  r.set("ta.roc", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = Math.max(0, intArg(c, 1, "length", 10));
    const now = toNum(src.get(0));
    const then = toNum(src.get(len));
    if (now === null || then === null || then === 0) return na();
    return (now - then) / then * 100;
  });
  r.set("ta.crossover", (c) => {
    const a = seriesArg(c, 0, "source1");
    const b = seriesArg(c, 1, "source2");
    const a0 = toNum(a.get(0));
    const b0 = toNum(b.get(0));
    const a1 = toNum(a.get(1));
    const b1 = toNum(b.get(1));
    if (a0 === null || b0 === null || a1 === null || b1 === null) return false;
    return a0 > b0 && a1 <= b1;
  });
  r.set("ta.crossunder", (c) => {
    const a = seriesArg(c, 0, "source1");
    const b = seriesArg(c, 1, "source2");
    const a0 = toNum(a.get(0));
    const b0 = toNum(b.get(0));
    const a1 = toNum(a.get(1));
    const b1 = toNum(b.get(1));
    if (a0 === null || b0 === null || a1 === null || b1 === null) return false;
    return a0 < b0 && a1 >= b1;
  });
  r.set("ta.cross", (c) => {
    const a = seriesArg(c, 0, "source1");
    const b = seriesArg(c, 1, "source2");
    const a0 = toNum(a.get(0));
    const b0 = toNum(b.get(0));
    const a1 = toNum(a.get(1));
    const b1 = toNum(b.get(1));
    if (a0 === null || b0 === null || a1 === null || b1 === null) return false;
    return a0 > b0 && a1 <= b1 || a0 < b0 && a1 >= b1;
  });
  r.set("ta.highest", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    return Math.max(...w);
  });
  r.set("ta.lowest", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    return Math.min(...w);
  });
  r.set("ta.highestbars", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    const max = Math.max(...w);
    return -w.indexOf(max);
  });
  r.set("ta.lowestbars", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    const min = Math.min(...w);
    return -w.indexOf(min);
  });
  r.set("ta.stdev", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const biasedArg = c.arg(2, "biased");
    const biased = biasedArg === null ? true : Boolean(biasedArg);
    const w = windowOf(src, len);
    if (!w) return na();
    const sd = stdevOf(w, biased);
    return Number.isFinite(sd) ? sd : na();
  });
  r.set("ta.variance", (c) => {
    const sd = r.get("ta.stdev")?.(c);
    const v = toNum(sd);
    return v === null ? na() : v * v;
  });
  r.set("ta.dev", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    const m = mean(w);
    let acc = 0;
    for (const v of w) acc += Math.abs(v - m);
    return acc / len;
  });
  r.set("ta.linreg", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const offset = intArg(c, 2, "offset", 0);
    const w = windowOf(src, len);
    if (!w) return na();
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < len; i++) {
      const x = i;
      const y = w[i];
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    }
    const denom = len * sxx - sx * sx;
    if (denom === 0) return na();
    const slope = (len * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / len;
    return intercept + slope * (len - 1 + offset);
  });
  r.set("ta.median", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    const sorted = w.slice().sort((a, b) => a - b);
    const mid = Math.floor(len / 2);
    return len % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  });
  r.set("ta.percentrank", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const w = windowOf(src, len);
    if (!w) return na();
    const current = w[0];
    let below = 0;
    for (const v of w) if (v < current) below++;
    return below / len * 100;
  });
  r.set("ta.rising", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    const cur = toNum(src.get(0));
    const past = toNum(src.get(len));
    if (cur === null || past === null) return false;
    for (let i = 0; i < len; i++) {
      const a = toNum(src.get(i));
      const b = toNum(src.get(i + 1));
      if (a === null || b === null || !(a > b)) return false;
    }
    return true;
  });
  r.set("ta.falling", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    for (let i = 0; i < len; i++) {
      const a = toNum(src.get(i));
      const b = toNum(src.get(i + 1));
      if (a === null || b === null || !(a < b)) return false;
    }
    return true;
  });
  r.set("ta.barssince", (c) => {
    const cond = c.arg(0, "condition");
    const st = c.state(() => ({ since: null }));
    if (cond !== null && cond !== false) {
      st.since = 0;
      return 0;
    }
    if (st.since === null) return na();
    st.since += 1;
    return st.since;
  });
  r.set("ta.valuewhen", (c) => {
    const cond = c.arg(0, "condition");
    const src = c.arg(1, "source");
    const occurrence = Math.max(0, intArg(c, 2, "occurrence", 0));
    const st = c.state(() => ({ values: [] }));
    if (cond !== null && cond !== false) st.values.push(src);
    const idx = st.values.length - 1 - occurrence;
    return idx >= 0 ? st.values[idx] : na();
  });
  r.set("ta.cum", (c) => {
    const src = c.arg(0, "source");
    const st = c.state(() => ({ total: 0 }));
    const v = toNum(src);
    st.total += v ?? 0;
    return st.total;
  });
  r.set("ta.hma", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length");
    if (len <= 0) return na();
    const half = Math.max(1, Math.round(len / 2));
    const sqrtLen = Math.max(1, Math.round(Math.sqrt(len)));
    const needed = len + sqrtLen;
    const raw = windowOf(src, needed);
    if (!raw) return na();
    const inner = [];
    for (let k = 0; k < sqrtLen; k++) {
      const slice = raw.slice(k, k + len);
      const wmaLen = wmaOfArray(slice, len);
      const sliceHalf = raw.slice(k, k + half);
      const wmaHalf = wmaOfArray(sliceHalf, half);
      if (wmaLen === null || wmaHalf === null) return na();
      inner.push(2 * wmaHalf - wmaLen);
    }
    return wmaOfArray(inner, sqrtLen);
  });
  r.set("ta.swma", (c) => {
    const src = seriesArg(c, 0, "source");
    const w = windowOf(src, 4);
    if (!w) return na();
    return (w[0] + 2 * w[1] + 2 * w[2] + w[3]) / 6;
  });
  r.set("ta.bb", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const mult = numArg(c, 2, "mult") ?? 2;
    const w = windowOf(src, len);
    if (!w) return new PineTuple([na(), na(), na()]);
    const basis = mean(w);
    const dev = stdevOf(w, true) * mult;
    return new PineTuple([basis, basis + dev, basis - dev]);
  });
  r.set("ta.bbw", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const mult = numArg(c, 2, "mult") ?? 2;
    const w = windowOf(src, len);
    if (!w) return na();
    const basis = mean(w);
    if (basis === 0) return na();
    const dev = stdevOf(w, true) * mult;
    return (basis + dev - (basis - dev)) / basis;
  });
  r.set("ta.macd", (c) => {
    const src = seriesArg(c, 0, "source");
    const fastLen = lenOf(c, 1, "fastlen", 12);
    const slowLen = lenOf(c, 2, "slowlen", 26);
    const sigLen = lenOf(c, 3, "siglen", 9);
    const st = c.state(() => ({ fast: emaState(), slow: emaState(), signal: emaState() }));
    const fast = emaOf(src, fastLen, st.fast);
    const slow = emaOf(src, slowLen, st.slow);
    if (fast === null || slow === null) return new PineTuple([na(), na(), na()]);
    const macd = fast - slow;
    const sig = emaRaw(macd, sigLen, st.signal);
    if (sig === null) return new PineTuple([macd, na(), na()]);
    return new PineTuple([macd, sig, macd - sig]);
  });
  r.set("ta.cci", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const w = windowOf(src, len);
    if (!w) return na();
    const m = mean(w);
    let acc = 0;
    for (const v of w) acc += Math.abs(v - m);
    const md = acc / len;
    if (md === 0) return na();
    return (w[0] - m) / (0.015 * md);
  });
  r.set("ta.cmo", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 14);
    let up = 0;
    let down = 0;
    for (let i = 0; i < len; i++) {
      const now = toNum(src.get(i));
      const prev = toNum(src.get(i + 1));
      if (now === null || prev === null) return na();
      const change = now - prev;
      if (change > 0) up += change;
      else down -= change;
    }
    if (up + down === 0) return 0;
    return (up - down) / (up + down) * 100;
  });
  r.set("ta.wpr", (c) => {
    const len = lenOf(c, 0, "length", 14);
    const high = windowOf(c.rt.seriesByName("high"), len);
    const low = windowOf(c.rt.seriesByName("low"), len);
    const close = toNum(c.rt.seriesByName("close").get(0));
    if (!high || !low || close === null) return na();
    const hh = Math.max(...high);
    const ll = Math.min(...low);
    if (hh === ll) return na();
    return (hh - close) / (hh - ll) * -100;
  });
  r.set("ta.stoch", (c) => {
    const src = seriesArg(c, 0, "source");
    const high = c.argSeries(1, "high");
    const low = c.argSeries(2, "low");
    const len = lenOf(c, 3, "length", 14);
    const hh = windowOf(high, len);
    const ll = windowOf(low, len);
    const cur = toNum(src.get(0));
    if (!hh || !ll || cur === null) return na();
    const top = Math.max(...hh);
    const bottom = Math.min(...ll);
    if (top === bottom) return na();
    return 100 * (cur - bottom) / (top - bottom);
  });
  r.set("ta.mfi", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 14);
    const vol = c.argSeries(2, "volume");
    const st = c.state(() => ({ prev: null, pos: [], neg: [] }));
    const v = toNum(src.get(0));
    const volume = toNum(vol.get(0)) ?? 0;
    if (v === null) return na();
    if (st.prev !== null) {
      const flow = v * volume;
      const up = v > st.prev;
      st.pos.push(up ? flow : 0);
      st.neg.push(up ? 0 : flow);
      if (st.pos.length > len) st.pos.shift();
      if (st.neg.length > len) st.neg.shift();
    }
    st.prev = v;
    if (st.pos.length < len) return na();
    const p = sum(st.pos);
    const n2 = sum(st.neg);
    if (p + n2 === 0) return na();
    return 100 * p / (p + n2);
  });
  r.set("ta.obv", (c) => {
    const close = toNum(c.rt.seriesByName("close").get(0));
    const prevClose = toNum(c.rt.seriesByName("close").get(1));
    const volume = toNum(c.rt.seriesByName("volume").get(0)) ?? 0;
    const st = c.state(() => ({ total: 0 }));
    if (close !== null && prevClose !== null) {
      if (close > prevClose) st.total += volume;
      else if (close < prevClose) st.total -= volume;
    }
    return st.total;
  });
  r.set("ta.cog", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 10);
    const w = windowOf(src, len);
    if (!w) return na();
    let num = 0;
    let den = 0;
    for (let i = 0; i < len; i++) {
      const v = w[i];
      num += v * (i + 1);
      den += v;
    }
    if (den === 0) return na();
    return -num / den;
  });
  r.set("ta.ao", (c) => {
    const hl2 = c.rt.seriesByName("hl2");
    const fast = smaOf(hl2, 5);
    const slow = smaOf(hl2, 34);
    if (fast === null || slow === null) return na();
    return fast - slow;
  });
  r.set("ta.correlation", (c) => {
    const a = windowOf(c.argSeries(0, "source1"), lenOf(c, 2, "length", 20));
    const b = windowOf(c.argSeries(1, "source2"), lenOf(c, 2, "length", 20));
    if (!a || !b) return na();
    const n2 = a.length;
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n2; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    if (da === 0 || db === 0) return na();
    return num / Math.sqrt(da * db);
  });
  r.set("ta.dmi", (c) => {
    const diLen = lenOf(c, 0, "diLength", 14);
    const adxLen = lenOf(c, 1, "lensig", 14);
    const high = c.rt.seriesByName("high");
    const low = c.rt.seriesByName("low");
    const h0 = toNum(high.get(0));
    const l0 = toNum(low.get(0));
    const h1 = toNum(high.get(1));
    const l1 = toNum(low.get(1));
    const st = c.state(() => ({ tr: rmaState(), plus: rmaState(), minus: rmaState(), adx: rmaState(), adxPrev: null }));
    if (h0 === null || l0 === null || h1 === null || l1 === null) return new PineTuple([na(), na(), na()]);
    const tr = trOf(c);
    const upMove = h0 - h1;
    const downMove = l1 - l0;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    if (tr === null) return new PineTuple([na(), na(), na()]);
    const atr = rmaRaw(tr, diLen, st.tr);
    const plusDi = rmaRaw(plusDm, diLen, st.plus);
    const minusDi = rmaRaw(minusDm, diLen, st.minus);
    if (atr === null || plusDi === null || minusDi === null || atr === 0) return new PineTuple([na(), na(), na()]);
    const pdi = 100 * plusDi / atr;
    const mdi = 100 * minusDi / atr;
    const dx = pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);
    const adx = rmaRaw(dx, adxLen, st.adx);
    return new PineTuple([pdi, mdi, adx]);
  });
  r.set("ta.tsi", (c) => {
    const src = seriesArg(c, 0, "source");
    const short = lenOf(c, 1, "short_length", 13);
    const long = lenOf(c, 2, "long_length", 25);
    const st = c.state(() => ({ prev: null, e1: emaState(), e2: emaState(), e3: emaState(), e4: emaState() }));
    const v = toNum(src.get(0));
    if (v === null) return na();
    const change = st.prev === null ? null : v - st.prev;
    st.prev = v;
    if (change === null) return na();
    const smooth = (st2, value) => emaRaw(value, long, st2);
    const first = smooth(st.e1, change);
    const second = first === null ? null : emaRaw(first, short, st.e2);
    const absFirst = smooth(st.e3, Math.abs(change));
    const absSecond = absFirst === null ? null : emaRaw(absFirst, short, st.e4);
    if (second === null || absSecond === null || absSecond === 0) return na();
    return 100 * second / absSecond;
  });
  r.set("ta.pivothigh", (c) => {
    const hasSource = positionals(c) >= 3;
    const src = hasSource ? c.argSeries(0, "source") : c.rt.seriesByName("high");
    const left = intArg(c, hasSource ? 1 : 0, "leftbars", 5);
    const right = intArg(c, hasSource ? 2 : 1, "rightbars", 5);
    const w = windowOf(src, left + right + 1);
    if (!w) return na();
    const mid = right;
    const pivot = w[mid];
    for (let i = 0; i < w.length; i++) {
      if (i === mid) continue;
      if (w[i] > pivot) return na();
    }
    return pivot;
  });
  r.set("ta.pivotlow", (c) => {
    const hasSource = positionals(c) >= 3;
    const src = hasSource ? c.argSeries(0, "source") : c.rt.seriesByName("low");
    const left = intArg(c, hasSource ? 1 : 0, "leftbars", 5);
    const right = intArg(c, hasSource ? 2 : 1, "rightbars", 5);
    const w = windowOf(src, left + right + 1);
    if (!w) return na();
    const mid = right;
    const pivot = w[mid];
    for (let i = 0; i < w.length; i++) {
      if (i === mid) continue;
      if (w[i] < pivot) return na();
    }
    return pivot;
  });
  r.set("ta.sar", (c) => {
    const start = numArg(c, 0, "start") ?? 0.02;
    const inc = numArg(c, 1, "inc") ?? 0.02;
    const max = numArg(c, 2, "max") ?? 0.2;
    const bar = c.rt.bar;
    if (!bar) return na();
    const st = c.state(() => ({ af: start, ep: null, sar: null, long: true }));
    if (st.sar === null) {
      st.sar = bar.low;
      st.ep = bar.high;
      st.long = true;
      return st.sar;
    }
    let sar = st.sar + st.af * ((st.ep ?? bar.high) - st.sar);
    if (st.long) {
      if (bar.low < sar) {
        st.long = false;
        sar = st.ep ?? bar.high;
        st.ep = bar.low;
        st.af = start;
      } else if (bar.high > (st.ep ?? bar.high)) {
        st.ep = bar.high;
        st.af = Math.min(max, st.af + inc);
      }
    } else {
      if (bar.high > sar) {
        st.long = true;
        sar = st.ep ?? bar.low;
        st.ep = bar.high;
        st.af = start;
      } else if (bar.low < (st.ep ?? bar.low)) {
        st.ep = bar.low;
        st.af = Math.min(max, st.af + inc);
      }
    }
    st.sar = sar;
    return sar;
  });
  r.set("ta.supertrend", (c) => {
    const factor = numArg(c, 0, "factor") ?? 3;
    const atrLen = intArg(c, 1, "atrPeriod", 10);
    const st = c.state(() => ({
      atr: rmaState(),
      up: null,
      dn: null,
      dir: 1
    }));
    const bar = c.rt.bar;
    const tr = trOf(c);
    if (tr === null || !bar) return new PineTuple([na(), na()]);
    const atr = rmaRaw(tr, atrLen, st.atr);
    if (atr === null) return new PineTuple([na(), na()]);
    const prevClose = toNum(c.rt.seriesByName("close").get(1));
    const hl2 = (bar.high + bar.low) / 2;
    let up = hl2 - factor * atr;
    let dn = hl2 + factor * atr;
    if (prevClose !== null) {
      if (st.up !== null && prevClose > st.up) up = Math.max(up, st.up);
      if (st.dn !== null && prevClose < st.dn) dn = Math.min(dn, st.dn);
      const prevDir = st.dir;
      const nextDir = prevDir === 1 ? bar.close < dn ? -1 : 1 : bar.close > up ? 1 : -1;
      st.dir = nextDir;
    }
    st.up = up;
    st.dn = dn;
    return new PineTuple([st.dir === 1 ? up : dn, st.dir]);
  });
  r.set("ta.kc", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const mult = numArg(c, 2, "mult") ?? 2;
    const useTrueRange = c.arg(3, "useTrueRange");
    const w = windowOf(src, len);
    if (!w) return new PineTuple([na(), na(), na()]);
    const basis = mean(w);
    let range;
    if (useTrueRange === false) {
      const h = windowOf(c.rt.seriesByName("high"), len);
      const l = windowOf(c.rt.seriesByName("low"), len);
      if (!h || !l) return new PineTuple([na(), na(), na()]);
      range = mean(h) - mean(l);
    } else {
      const atr = r.get("ta.atr");
      range = null;
      if (atr) {
        const v = toNum(atr(c));
        range = v;
      }
    }
    if (range === null) return new PineTuple([na(), na(), na()]);
    return new PineTuple([basis, basis + mult * range, basis - mult * range]);
  });
  r.set("ta.percentile_nearest_rank", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 100);
    const pct = numArg(c, 2, "percentage") ?? 50;
    const w = windowOf(src, len);
    if (!w) return na();
    const sorted = w.slice().sort((a, b) => a - b);
    const rank2 = Math.ceil(pct / 100 * sorted.length);
    return sorted[Math.max(0, Math.min(sorted.length - 1, rank2 - 1))];
  });
}
function rmaRaw(value, len, st) {
  if (len <= 0) return null;
  if (st.len !== len) {
    st.len = len;
    st.prev = null;
    st.seedSum = 0;
    st.seedCount = 0;
  }
  if (st.prev === null) {
    st.seedSum += value;
    st.seedCount++;
    if (st.seedCount >= len) {
      st.prev = st.seedSum / len;
      return st.prev;
    }
    return null;
  }
  st.prev = (st.prev * (len - 1) + value) / len;
  return st.prev;
}
function emaRaw(value, len, st) {
  if (len <= 0) return null;
  if (st.len !== len) {
    st.len = len;
    st.prev = null;
    st.seedSum = 0;
    st.seedCount = 0;
  }
  if (st.prev === null) {
    st.seedSum += value;
    st.seedCount++;
    if (st.seedCount >= len) {
      st.prev = st.seedSum / len;
      return st.prev;
    }
    return null;
  }
  const alpha = 2 / (len + 1);
  st.prev = alpha * value + (1 - alpha) * st.prev;
  return st.prev;
}
function wmaOfArray(values, len) {
  if (values.length < len || len <= 0) return null;
  let acc = 0;
  let weight = 0;
  for (let i = 0; i < len; i++) {
    const k = len - i;
    acc += values[i] * k;
    weight += k;
  }
  return acc / weight;
}
function percentileNearestRank(values, percent) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank2 = Math.ceil(percent / 100 * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank2 - 1));
  return sorted[idx] ?? null;
}
function percentileLinearInterpolation(values, percent) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  const rank2 = percent / 100 * (sorted.length - 1);
  const lower = Math.floor(rank2);
  const upper = Math.ceil(rank2);
  const lo = sorted[lower];
  const hi = sorted[upper];
  return lo + (hi - lo) * (rank2 - lower);
}
function rciOf(values) {
  const n2 = values.length;
  if (n2 < 2) return null;
  const indexed = values.map((v, i) => ({ v, i }));
  const byValue = indexed.slice().sort((a, b) => a.v - b.v);
  const rankOfValue = new Array(n2).fill(0);
  for (let k = 0; k < n2; k++) {
    const item = byValue[k];
    rankOfValue[item.i] = k + 1;
  }
  let d2 = 0;
  for (let i = 0; i < n2; i++) {
    const diff = i + 1 - rankOfValue[i];
    d2 += diff * diff;
  }
  return (1 - 6 * d2 / (n2 * (n2 * n2 - 1))) * 100;
}
function registerTaExtended(r) {
  r.set("ta.alma", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 9);
    const offset = numArg(c, 2, "offset") ?? 0.85;
    const sigma = numArg(c, 3, "sigma") ?? 6;
    const w = windowOf(src, len);
    if (!w || len <= 0) return na();
    const m = offset * (len - 1);
    const s2 = len / sigma;
    let acc = 0;
    let norm = 0;
    for (let i = 0; i < len; i++) {
      const weight = Math.exp(-((i - m) * (i - m)) / (2 * s2 * s2));
      acc += w[len - 1 - i] * weight;
      norm += weight;
    }
    return norm === 0 ? na() : acc / norm;
  });
  const vwapValue = (c) => {
    const src = c.args.length > 0 ? seriesArg(c, 0, "source") : c.rt.seriesByName("hlc3");
    const volume = c.rt.seriesByName("volume");
    const st = c.state(() => ({ sumPv: 0, sumV: 0 }));
    const price = toNum(src.get(0));
    const vol = toNum(volume.get(0));
    if (price === null || vol === null || !Number.isFinite(price) || !Number.isFinite(vol)) return st.sumV > 0 ? st.sumPv / st.sumV : na();
    st.sumPv += price * vol;
    st.sumV += vol;
    return st.sumV === 0 ? na() : st.sumPv / st.sumV;
  };
  r.set("ta.vwap", vwapValue);
  r.set("ta.kcw", (c) => {
    const source = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const mult = numArg(c, 2, "mult") ?? 2;
    const useTrueRangeArg = c.arg(3, "useTrueRange");
    const useTrueRange = useTrueRangeArg === false ? false : true;
    const w = windowOf(source, len);
    if (!w) return na();
    const basis = mean(w);
    const high = c.rt.seriesByName("high");
    const low = c.rt.seriesByName("low");
    const close = c.rt.seriesByName("close");
    let ranges = [];
    for (let i = len - 1; i >= 0; i--) {
      const h = toNum(high.get(i));
      const l = toNum(low.get(i));
      if (h === null || l === null) {
        ranges = null;
        break;
      }
      if (!useTrueRange) {
        ranges.push(h - l);
        continue;
      }
      const prev = toNum(close.get(i + 1));
      ranges.push(
        prev === null ? h - l : Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev))
      );
    }
    if (ranges === null || basis === 0) return na();
    return mean(ranges) * mult * 2 / basis;
  });
  r.set("ta.range", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 14);
    const w = windowOf(src, len);
    if (!w) return na();
    return Math.max(...w) - Math.min(...w);
  });
  r.set("ta.accdist", (c) => {
    const st = c.state(() => ({ total: 0 }));
    const high = toNum(c.rt.seriesByName("high").get(0));
    const low = toNum(c.rt.seriesByName("low").get(0));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const volume = toNum(c.rt.seriesByName("volume").get(0)) ?? 0;
    if (high === null || low === null || close === null || high === low) return st.total;
    st.total += (close - low - (high - close)) / (high - low) * volume;
    return st.total;
  });
  r.set("ta.iii", (c) => {
    const st = c.state(() => ({ total: 0 }));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const high = toNum(c.rt.seriesByName("high").get(0));
    const low = toNum(c.rt.seriesByName("low").get(0));
    const volume = volumeOf(c) ?? 0;
    if (close === null || high === null || low === null || high === low) return st.total;
    st.total += (2 * close - high - low) / (high - low) * volume;
    return st.total;
  });
  const positiveVolumeIndex = (name, invert) => (c) => {
    const st = c.state(() => ({ value: 1e3 }));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const prevClose = toNum(c.rt.seriesByName("close").get(1));
    const volume = toNum(c.rt.seriesByName("volume").get(0)) ?? 0;
    const prevVolume = toNum(c.rt.seriesByName("volume").get(1)) ?? 0;
    if (close === null || prevClose === null || close === 0 || prevClose === 0) return st.value;
    const rising = volume > prevVolume;
    const applies = invert ? !rising : rising;
    if (applies) st.value *= close / prevClose;
    void name;
    return st.value;
  };
  r.set("ta.pvi", positiveVolumeIndex("pvi", false));
  r.set("ta.nvi", positiveVolumeIndex("nvi", true));
  r.set("ta.pvt", (c) => {
    const st = c.state(() => ({ total: 0 }));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const prevClose = toNum(c.rt.seriesByName("close").get(1));
    const volume = toNum(c.rt.seriesByName("volume").get(0)) ?? 0;
    if (close === null || prevClose === null || prevClose === 0) return st.total;
    st.total += (close - prevClose) / prevClose * volume;
    return st.total;
  });
  r.set("ta.wad", (c) => {
    const st = c.state(() => ({ total: 0 }));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const prevClose = toNum(c.rt.seriesByName("close").get(1));
    const high = toNum(c.rt.seriesByName("high").get(0));
    const low = toNum(c.rt.seriesByName("low").get(0));
    if (close === null || prevClose === null || high === null || low === null) return st.total;
    st.total += (close > prevClose ? close - Math.min(low, prevClose) : close - Math.max(high, prevClose)) * (volumeOf(c) ?? 0);
    return st.total;
  });
  r.set("ta.wvad", (c) => {
    const st = c.state(() => ({ total: 0 }));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const open2 = toNum(c.rt.seriesByName("open").get(0));
    const high = toNum(c.rt.seriesByName("high").get(0));
    const low = toNum(c.rt.seriesByName("low").get(0));
    const volume = volumeOf(c) ?? 0;
    if (close === null || open2 === null || high === null || low === null || high === low) return st.total;
    st.total += (close - open2) / (high - low) * volume;
    return st.total;
  });
  r.set("ta.rci", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 9);
    const w = windowOf(src, len);
    if (!w) return na();
    return rciOf(w.slice().reverse());
  });
  r.set("ta.max", (c) => {
    const length = lengthArg(c, 1);
    if (length !== null) {
      const w = windowOf(seriesArg(c, 0, "source"), length);
      return w ? Math.max(...w) : na();
    }
    const value = numArg(c, 0, "source");
    const st = c.state(() => ({ max: null }));
    if (value === null) return st.max;
    if (st.max === null || value > st.max) st.max = value;
    return st.max;
  });
  r.set("ta.min", (c) => {
    const length = lengthArg(c, 1);
    if (length !== null) {
      const w = windowOf(seriesArg(c, 0, "source"), length);
      return w ? Math.min(...w) : na();
    }
    const value = numArg(c, 0, "source");
    const st = c.state(() => ({ min: null }));
    if (value === null) return st.min;
    if (st.min === null || value < st.min) st.min = value;
    return st.min;
  });
  const windowStat = (fn) => (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const w = windowOf(src, len);
    return w ? fn(w) : na();
  };
  r.set("ta.median", windowStat((w) => percentileLinearInterpolation(w, 50)));
  r.set("ta.mode", windowStat((w) => {
    const counts = /* @__PURE__ */ new Map();
    for (const v of w) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = null;
    let bestCount = 1;
    for (const [value, count] of counts) {
      if (count > bestCount || count === bestCount && best !== null && value < best) {
        best = value;
        bestCount = count;
      }
    }
    return bestCount > 1 ? best : null;
  }));
  r.set("ta.percentile_linear_interpolation", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const percent = numArg(c, 2, "percentage") ?? 50;
    const w = windowOf(src, len);
    return w ? percentileLinearInterpolation(w, percent) : na();
  });
  r.set("ta.percentile_nearest_rank", (c) => {
    const src = seriesArg(c, 0, "source");
    const len = lenOf(c, 1, "length", 20);
    const percent = numArg(c, 2, "percentage") ?? 50;
    const w = windowOf(src, len);
    return w ? percentileNearestRank(w, percent) : na();
  });
  r.set("ta.pivot_point_levels", (c) => {
    const type = typeof c.arg(0, "type") === "string" ? c.arg(0, "type") : "traditional";
    const anchor = c.argSeries(1, "anchor");
    const st = c.state(() => ({ levels: null }));
    const high = toNum(c.rt.seriesByName("high").get(0));
    const low = toNum(c.rt.seriesByName("low").get(0));
    const close = toNum(c.rt.seriesByName("close").get(0));
    const open2 = toNum(c.rt.seriesByName("open").get(0));
    const newAnchor = toNum(anchor.get(0)) !== null && (toNum(anchor.get(1)) === null || anchor.get(0) !== anchor.get(1));
    if (high !== null && low !== null && close !== null && (st.levels === null || newAnchor)) {
      const range = high - low;
      const pp = (high + low + close) / 3;
      let levels2;
      switch (type) {
        case "fibonacci": {
          levels2 = [pp, pp + 0.382 * range, pp + 0.618 * range, pp + range, pp + 1.618 * range, pp - 0.382 * range, pp - 0.618 * range, pp - range, pp - 1.618 * range, high, low];
          break;
        }
        case "woodie": {
          const wpp = (high + low + 2 * (open2 ?? close)) / 4;
          levels2 = [wpp, 2 * wpp - low, high + 2 * (wpp - low), high + 2 * (wpp - low) + (wpp - low), high + 2 * (wpp - low) + 2 * (wpp - low), 2 * wpp - high, low - 2 * (high - wpp), wpp - (high - low), wpp - 2 * (high - low), high, low];
          break;
        }
        case "camarilla": {
          const k = range;
          levels2 = [close, close + k * 1.1 / 12, close + k * 1.1 / 6, close + k * 1.1 / 4, close + k * 1.1 / 2, close - k * 1.1 / 12, close - k * 1.1 / 6, close - k * 1.1 / 4, close - k * 1.1 / 2, high, low];
          break;
        }
        case "dm": {
          const x = close < (open2 ?? close) ? high + 2 * low + close : close > (open2 ?? close) ? 2 * high + low + close : high + low + 2 * close;
          levels2 = [x / 4, x / 2 - low, x / 2 - high, x - 2 * low, x - high, x - 2 * high, x - low, x / 2 + high, x / 2 + low, high, low];
          break;
        }
        default: {
          levels2 = [pp, 2 * pp - low, 2 * pp - high, pp + range, pp + 2 * range, pp - range, pp - 2 * range, high + 2 * (pp - low), low - 2 * (high - pp), high, low];
          break;
        }
      }
      st.levels = levels2;
    }
    const levels = st.levels ?? [];
    return new PineArray(Array.from({ length: 11 }, (_, i) => levels[i] ?? null), "float");
  });
}
function positionals(c) {
  return c.args.filter((a) => a.name === void 0).length;
}
function volumeOf(c) {
  return toNum(c.rt.seriesByName("volume").get(0));
}

// src/runtime/builtins/math.ts
function n(v) {
  const x = toNum(v);
  return x === null || !Number.isFinite(x) ? null : x;
}
function registerMath(r) {
  const unary = (name, fn) => {
    r.set(`math.${name}`, (c) => {
      const x = n(c.arg(0, "number"));
      if (x === null) return null;
      const y = fn(x);
      return Number.isFinite(y) || Number.isNaN(y) ? Number.isNaN(y) ? null : y : y;
    });
  };
  unary("abs", Math.abs);
  unary("sqrt", Math.sqrt);
  unary("log", Math.log);
  unary("log10", Math.log10);
  unary("exp", Math.exp);
  unary("floor", Math.floor);
  unary("ceil", Math.ceil);
  unary("sign", Math.sign);
  unary("sin", Math.sin);
  unary("cos", Math.cos);
  unary("tan", Math.tan);
  unary("asin", Math.asin);
  unary("acos", Math.acos);
  unary("atan", Math.atan);
  unary("cosh", Math.cosh);
  unary("sinh", Math.sinh);
  unary("tanh", Math.tanh);
  unary("acosh", Math.acosh);
  unary("asinh", Math.asinh);
  unary("atanh", Math.atanh);
  unary("todegrees", (x) => x * 180 / Math.PI);
  unary("toradians", (x) => x * Math.PI / 180);
  r.set("math.round", (c) => {
    const x = n(c.arg(0, "number"));
    if (x === null) return null;
    const p = numArg(c, 1, "precision");
    if (p === null) return Math.round(x);
    const f = Math.pow(10, Math.trunc(p));
    return Math.round(x * f) / f;
  });
  r.set("math.pow", (c) => {
    const base3 = n(c.arg(0, "base"));
    const exp = n(c.arg(1, "exponent"));
    if (base3 === null || exp === null) return null;
    const y = Math.pow(base3, exp);
    return Number.isNaN(y) ? null : y;
  });
  r.set("math.max", (c) => {
    const values = collectArgs(c.args.map((_, i) => c.arg(i)));
    if (values.length === 0) return null;
    let best = null;
    for (const v of values) if (best === null || v > best) best = v;
    return best;
  });
  r.set("math.min", (c) => {
    const values = collectArgs(c.args.map((_, i) => c.arg(i)));
    if (values.length === 0) return null;
    let best = null;
    for (const v of values) if (best === null || v < best) best = v;
    return best;
  });
  r.set("math.avg", (c) => {
    const values = collectArgs(c.args.map((_, i) => c.arg(i)));
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  });
  r.set("math.sum", (c) => {
    const length = toNum(c.arg(1, "length"));
    const windowArg = c.argExpr(0);
    if (windowArg && length !== null && length > 0) {
      const window = windowOf(c.argSeries(0, "source"), Math.round(length));
      if (!window) return null;
      return window.reduce((a, b) => a + b, 0);
    }
    const values = collectArgs(c.args.map((_, i) => c.arg(i)));
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0);
  });
  r.set("math.factorial", (c) => {
    const x = n(c.arg(0, "number"));
    if (x === null || x < 0) return null;
    let acc = 1;
    for (let i = 2; i <= Math.trunc(x); i++) acc *= i;
    return acc;
  });
  r.set("math.round_to_mintick", (c) => {
    const x = n(c.arg(0, "number"));
    if (x === null) return null;
    const tick = c.rt.market.symbolInfo?.mintick ?? 0.01;
    return Math.round(x / tick) * tick;
  });
  r.set("math.random", (c) => {
    const st = c.state(() => ({ seed: 49734321 }));
    const min = numArg(c, 0, "min") ?? 0;
    const max = numArg(c, 1, "max") ?? 1;
    st.seed = st.seed * 1664525 + 1013904223 >>> 0;
    const u = st.seed / 4294967296;
    return min + (max - min) * u;
  });
}
function collectArgs(values) {
  const out = [];
  for (const v of values) {
    const x = toNum(v);
    if (x !== null && Number.isFinite(x)) out.push(x);
  }
  return out;
}

// src/runtime/builtins/str.ts
function s(v) {
  if (v === null) return null;
  return toStr(v);
}
function registerStr(r) {
  r.set("str.tostring", (c) => {
    const v = c.arg(0, "value");
    if (v === null) return null;
    const fmt = c.arg(1, "format");
    if (typeof v === "number" && typeof fmt === "string" && fmt.startsWith("#")) {
      return formatPattern(v, fmt);
    }
    return toStr(v);
  });
  r.set("str.tonumber", (c) => {
    const raw = s(c.arg(0, "string"));
    if (raw === null) return null;
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : null;
  });
  r.set("str.length", (c) => {
    const raw = s(c.arg(0, "string"));
    return raw === null ? null : raw.length;
  });
  r.set("str.substring", (c) => {
    const raw = s(c.arg(0, "string"));
    if (raw === null) return null;
    const begin = intArg(c, 1, "begin_pos", 0);
    const endArg = c.arg(2, "end_pos");
    const end = endArg === null ? raw.length : Math.trunc(Number(endArg));
    return raw.slice(begin, end);
  });
  r.set("str.contains", (c) => {
    const raw = s(c.arg(0, "source"));
    const needle = s(c.arg(1, "str"));
    if (raw === null || needle === null) return false;
    return raw.includes(needle);
  });
  r.set("str.startswith", (c) => {
    const raw = s(c.arg(0, "source"));
    const needle = s(c.arg(1, "str"));
    if (raw === null || needle === null) return false;
    return raw.startsWith(needle);
  });
  r.set("str.endswith", (c) => {
    const raw = s(c.arg(0, "source"));
    const needle = s(c.arg(1, "str"));
    if (raw === null || needle === null) return false;
    return raw.endsWith(needle);
  });
  r.set("str.replace", (c) => {
    const raw = s(c.arg(0, "source"));
    const target = s(c.arg(1, "target"));
    const replacement = s(c.arg(2, "replacement")) ?? "";
    if (raw === null || target === null) return null;
    return raw.replace(target, replacement);
  });
  r.set("str.replace_all", (c) => {
    const raw = s(c.arg(0, "source"));
    const target = s(c.arg(1, "target"));
    const replacement = s(c.arg(2, "replacement")) ?? "";
    if (raw === null || target === null) return null;
    return raw.split(target).join(replacement);
  });
  r.set("str.split", (c) => {
    const raw = s(c.arg(0, "string"));
    const sep = s(c.arg(1, "separator")) ?? "";
    if (raw === null) return new PineArray([], "string");
    return new PineArray(raw.split(sep), "string");
  });
  r.set("str.upper", (c) => {
    const raw = s(c.arg(0, "string"));
    return raw === null ? null : raw.toUpperCase();
  });
  r.set("str.lower", (c) => {
    const raw = s(c.arg(0, "string"));
    return raw === null ? null : raw.toLowerCase();
  });
  r.set("str.repeat", (c) => {
    const raw = s(c.arg(0, "source"));
    const count = intArg(c, 1, "repeat", 0);
    if (raw === null || count <= 0) return null;
    return raw.repeat(count);
  });
  r.set("str.format", (c) => {
    const template = s(c.arg(0, "format_str"));
    if (template === null) return null;
    const values = [];
    for (let i = 1; i < c.args.length; i++) values.push(toStr(c.arg(i)));
    return template.replace(/\{(\d+)(?:,\s*number\s*,\s*([^}]+))?\}/g, (_m, idx, fmt) => {
      const value = values[Number(idx)];
      if (value === void 0) return "";
      if (fmt) {
        const precision = /number\.(#+)|\d+/.exec(fmt);
        const digits = precision ? (precision[1] ?? precision[0]).length : 2;
        const num = Number(value);
        return Number.isFinite(num) ? num.toFixed(digits) : value;
      }
      return value;
    });
  });
  r.set("str.match", (c) => {
    const raw = s(c.arg(0, "source"));
    const pattern = s(c.arg(1, "regex"));
    if (raw === null || pattern === null) return null;
    try {
      const re = new RegExp(pattern);
      const m = re.exec(raw);
      return m ? m[1] ?? m[0] : null;
    } catch {
      return null;
    }
  });
  r.set("str.tostring_number", (c) => {
    const v = numArg(c, 0, "value");
    const digits = intArg(c, 1, "precision", 2);
    if (v === null) return null;
    return v.toFixed(digits);
  });
}
function formatPattern(value, pattern) {
  const decimals = /\.([0#]+)/.exec(pattern)?.[1] ?? "";
  const scaled = pattern.includes("%") ? value * 100 : value;
  let out = scaled.toFixed(decimals.length);
  for (let i = decimals.length - 1; i >= 0 && decimals[i] === "#"; i--) {
    const dot = out.indexOf(".");
    if (dot < 0 || out.length - dot - 1 < i + 1) break;
    if (out.endsWith("0")) out = out.slice(0, -1);
    else break;
  }
  if (out.endsWith(".")) out = out.slice(0, -1);
  return pattern.includes("%") ? `${out}%` : out;
}
function registerStrExtended(r) {
  r.set("str.join", (c) => {
    const separator = strArg(c, 0, "separator", "");
    const arr2 = c.arg(1, "array");
    if (!(arr2 instanceof PineArray)) return null;
    return arr2.items.map((v) => toStr(v) ?? "na").join(separator);
  });
  r.set("str.pos", (c) => {
    const haystack = strArg(c, 0, "source", "");
    const needle = strArg(c, 1, "str", "");
    return haystack.indexOf(needle);
  });
  r.set("str.trim", (c) => {
    const value = strArg(c, 0, "source", "");
    const mode2 = c.arg(1, "trim_type");
    if (mode2 === "left") return value.replace(/^\s+/, "");
    if (mode2 === "right") return value.replace(/\s+$/, "");
    return value.trim();
  });
  r.set("str.format_time", (c) => {
    const time = numArg(c, 0, "time");
    const format = strArg(c, 1, "format", "yyyy-MM-dd HH:mm:ss");
    const timezone = strArg(c, 2, "timezone", "UTC");
    if (time === null || !Number.isFinite(time)) return null;
    return formatIso(new Date(time), format, timezone);
  });
}
function formatIso(date, pattern, timezone) {
  const pad = (n2, width = 2) => String(Math.abs(n2)).padStart(width, "0");
  const utc = timezone.toUpperCase() === "UTC" || timezone.toUpperCase() === "GMT";
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  const hours = utc ? date.getUTCHours() : date.getHours();
  const minutes = utc ? date.getUTCMinutes() : date.getMinutes();
  const seconds = utc ? date.getUTCSeconds() : date.getSeconds();
  return pattern.replace(/yyyy/g, String(year)).replace(/MM/g, pad(month)).replace(/dd/g, pad(day)).replace(/HH/g, pad(hours)).replace(/mm/g, pad(minutes)).replace(/ss/g, pad(seconds));
}

// src/runtime/builtins/array.ts
function arr(c) {
  const v = c.receiver ?? c.arg(0, "id");
  return isArray(v) ? v : null;
}
function indexOf(c, raw, length) {
  const index = Math.trunc(raw);
  if (index >= 0) return index;
  if (!c.rt.isV6) return index;
  return length + index;
}
function requireIndex(c, raw, length, allowEnd = false) {
  const index = indexOf(c, raw, length);
  const limit = allowEnd ? length : length - 1;
  if (index < 0 || index > limit) {
    throw new PineRuntimeError(
      `Array index ${Math.trunc(raw)} is out of bounds for an array of size ${length}`,
      "SCRIPT_ERROR"
    );
  }
  return index;
}
function argIndex(c) {
  return c.receiver !== void 0 ? 0 : 1;
}
function registerArray(r) {
  const make = (type) => (c) => {
    const size = Math.max(0, intArg(c, 0, "size", 0));
    const initial = c.arg(1, "initial_value");
    return new PineArray(new Array(size).fill(initial ?? null), type);
  };
  for (const [name, type] of [
    ["new_float", "float"],
    ["new_int", "int"],
    ["new_bool", "bool"],
    ["new_string", "string"],
    ["new_color", "color"],
    ["new_line", "line"],
    ["new_label", "label"],
    ["new_box", "box"]
  ]) {
    r.set(`array.${name}`, make(type));
  }
  r.set("array.new", make("float"));
  r.set("array.push", (c) => {
    const a = arr(c);
    if (!a) return null;
    a.push(c.arg(argIndex(c), "value"));
    return null;
  });
  r.set("array.pop", (c) => {
    const a = arr(c);
    return a ? a.pop() : null;
  });
  r.set("array.get", (c) => {
    const a = arr(c);
    if (!a) return null;
    const index = toNum(c.arg(argIndex(c), "index"));
    if (index === null) return null;
    return a.get(requireIndex(c, index, a.items.length));
  });
  r.set("array.set", (c) => {
    const a = arr(c);
    if (!a) return null;
    const index = toNum(c.arg(argIndex(c), "index"));
    if (index === null) return null;
    a.set(requireIndex(c, index, a.items.length), c.arg(argIndex(c) + 1, "value"));
    return null;
  });
  r.set("array.size", (c) => {
    const a = arr(c);
    return a ? a.items.length : 0;
  });
  r.set("array.shift", (c) => {
    const a = arr(c);
    return a ? a.shift() : null;
  });
  r.set("array.unshift", (c) => {
    const a = arr(c);
    if (!a) return null;
    a.unshift(c.arg(argIndex(c), "value"));
    return null;
  });
  r.set("array.insert", (c) => {
    const a = arr(c);
    if (!a) return null;
    const index = toNum(c.arg(argIndex(c), "index"));
    if (index === null) return null;
    const i = requireIndex(c, index, a.items.length, true);
    a.items.splice(i, 0, c.arg(argIndex(c) + 1, "value"));
    return null;
  });
  r.set("array.remove", (c) => {
    const a = arr(c);
    if (!a) return null;
    const index = toNum(c.arg(argIndex(c), "index"));
    if (index === null) return null;
    const i = requireIndex(c, index, a.items.length);
    return a.items.splice(i, 1)[0] ?? null;
  });
  r.set("array.clear", (c) => {
    arr(c)?.clear();
    return null;
  });
  r.set("array.copy", (c) => {
    const a = arr(c);
    return a ? a.clone() : new PineArray();
  });
  r.set("array.concat", (c) => {
    const a = arr(c);
    const b = c.arg(argIndex(c), "id2");
    if (!a || !isArray(b)) return a ?? new PineArray();
    a.items.push(...b.items);
    return a;
  });
  r.set("array.slice", (c) => {
    const a = arr(c);
    if (!a) return new PineArray();
    const from = Math.trunc(numArg(c, argIndex(c), "index_from") ?? 0);
    const to = Math.trunc(numArg(c, argIndex(c) + 1, "index_to") ?? a.items.length);
    return new PineArray(a.items.slice(from, to), a.elemType);
  });
  r.set("array.reverse", (c) => {
    arr(c)?.items.reverse();
    return null;
  });
  r.set("array.includes", (c) => {
    const a = arr(c);
    if (!a) return false;
    return a.items.includes(c.arg(argIndex(c), "value"));
  });
  r.set("array.indexof", (c) => {
    const a = arr(c);
    if (!a) return -1;
    return a.items.indexOf(c.arg(argIndex(c), "value"));
  });
  r.set("array.lastindexof", (c) => {
    const a = arr(c);
    if (!a) return -1;
    return a.items.lastIndexOf(c.arg(argIndex(c), "value"));
  });
  r.set("array.join", (c) => {
    const a = arr(c);
    if (!a) return null;
    const sep = c.arg(argIndex(c), "separator");
    return a.items.map((v) => toStr(v)).join(sep === null ? "," : toStr(sep));
  });
  r.set("array.sort", (c) => {
    const a = arr(c);
    if (!a) return null;
    const order = c.arg(argIndex(c), "order");
    const dir = order === "desc" || order === "descending" || order === -1 ? -1 : 1;
    a.items.sort((x, y) => compare(x, y) * dir);
    return null;
  });
  r.set("array.sort_indices", (c) => {
    const a = arr(c);
    if (!a) return new PineArray([], "int");
    const order = c.arg(argIndex(c), "order");
    const dir = order === "desc" || order === "descending" || order === -1 ? -1 : 1;
    const indices = a.items.map((_, i) => i);
    indices.sort((x, y) => compare(a.items[x] ?? null, a.items[y] ?? null) * dir);
    return new PineArray(indices, "int");
  });
  const agg = (name, fn) => {
    r.set(`array.${name}`, (c) => {
      const a = arr(c);
      if (!a) return null;
      const values = a.items.map((v) => toNum(v)).filter((v) => v !== null && Number.isFinite(v));
      if (values.length === 0) return null;
      return fn(values);
    });
  };
  agg("sum", (v) => v.reduce((x, y) => x + y, 0));
  agg("avg", (v) => v.reduce((x, y) => x + y, 0) / v.length);
  agg("min", (v) => Math.min(...v));
  agg("max", (v) => Math.max(...v));
  agg("range", (v) => Math.max(...v) - Math.min(...v));
  agg("median", (v) => {
    const sorted = v.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  });
  agg("stdev", (v) => {
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    return Math.sqrt(v.reduce((acc, x) => acc + (x - m) * (x - m), 0) / v.length);
  });
  agg("variance", (v) => {
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    return v.reduce((acc, x) => acc + (x - m) * (x - m), 0) / v.length;
  });
  agg("cum", (v) => v.reduce((acc, x) => acc + x, 0));
  r.set("array.abs", (c) => {
    const a = arr(c);
    if (!a) return null;
    a.items = a.items.map((v) => {
      const n2 = toNum(v);
      return n2 === null ? v : Math.abs(n2);
    });
    return a;
  });
  r.set("array.from", (c) => new PineArray(c.args.map((_, i) => c.arg(i)), "float"));
}
function compare(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return toStr(a) < toStr(b) ? -1 : toStr(a) > toStr(b) ? 1 : 0;
}
function registerArrayExtended(r) {
  const self3 = (c) => {
    const v = c.receiver !== void 0 ? c.receiver : c.arg(0, "id");
    return v instanceof PineArray ? v : null;
  };
  const base3 = (c) => c.receiver !== void 0 ? 0 : 1;
  const numbers = (a) => a.items.map((v) => toNum(v)).filter((v) => v !== null && Number.isFinite(v));
  r.set("array.first", (c) => self3(c)?.items[0] ?? null);
  r.set("array.last", (c) => {
    const a = self3(c);
    return a && a.items.length > 0 ? a.items[a.items.length - 1] ?? null : null;
  });
  r.set("array.fill", (c) => {
    const a = self3(c);
    if (!a) return null;
    const value = c.arg(base3(c), "value");
    a.items = a.items.map(() => value);
    return null;
  });
  const search = (mode2) => (c) => {
    const a = self3(c);
    if (!a) return null;
    const value = c.arg(base3(c), "value");
    const sorted = a.items.map((v, i) => ({ v, i })).filter((e) => e.v !== null);
    const cmp2 = (x) => compare(x, value);
    let lo = 0;
    let hi = sorted.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      const c0 = cmp2(sorted[mid].v);
      if (c0 === 0) {
        found = sorted[mid].i;
        if (mode2 === "leftmost") hi = mid - 1;
        else if (mode2 === "rightmost") lo = mid + 1;
        else break;
      } else if (c0 < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return found;
  };
  r.set("array.binary_search", search("any"));
  r.set("array.binary_search_leftmost", search("leftmost"));
  r.set("array.binary_search_rightmost", search("rightmost"));
  r.set("array.covariance", (c) => {
    const a = self3(c);
    const b = c.arg(base3(c), "id2");
    if (!a || !(b instanceof PineArray)) return null;
    const xs = numbers(a);
    const ys = numbers(b);
    const n2 = Math.min(xs.length, ys.length);
    if (n2 < 2) return null;
    const mx = xs.slice(0, n2).reduce((x, y) => x + y, 0) / n2;
    const my = ys.slice(0, n2).reduce((x, y) => x + y, 0) / n2;
    let acc = 0;
    for (let i = 0; i < n2; i++) acc += (xs[i] - mx) * (ys[i] - my);
    const biased = c.arg(base3(c) + 1, "biased") === true;
    return acc / (biased ? n2 : n2 - 1);
  });
  r.set("array.mode", (c) => {
    const a = self3(c);
    if (!a) return null;
    const values = numbers(a);
    const counts = /* @__PURE__ */ new Map();
    let best = null;
    let bestCount = 1;
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [value, count] of counts) {
      if (count > bestCount || count === bestCount && best !== null && value < best) {
        best = value;
        bestCount = count;
      }
    }
    return bestCount > 1 ? best : null;
  });
  r.set("array.percentile_linear_interpolation", (c) => {
    const a = self3(c);
    const percent = toNum(c.arg(base3(c), "percentage"));
    if (!a || percent === null) return null;
    return percentileLinear(numbers(a), percent);
  });
  r.set("array.percentile_nearest_rank", (c) => {
    const a = self3(c);
    const percent = toNum(c.arg(base3(c), "percentage"));
    if (!a || percent === null) return null;
    return percentileNearest(numbers(a), percent);
  });
  r.set("array.percentrank", (c) => {
    const a = self3(c);
    const index = toNum(c.arg(base3(c), "index"));
    if (!a || index === null) return null;
    const target = toNum(a.get(Math.trunc(index)));
    const values = numbers(a);
    if (target === null || values.length === 0) return null;
    const below = values.filter((v) => v < target).length;
    return below / values.length * 100;
  });
  r.set("array.standardize", (c) => {
    const a = self3(c);
    if (!a) return null;
    const values = numbers(a);
    if (values.length === 0) return null;
    const m = values.reduce((x, y) => x + y, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) {
      a.items = a.items.map(() => null);
      return a;
    }
    a.items = a.items.map((v) => {
      const n2 = toNum(v);
      return n2 === null ? null : (n2 - m) / sd;
    });
    return a;
  });
  r.set("array.every", (c) => {
    const a = self3(c);
    if (!a) return null;
    const fn = c.arg(base3(c), "predicate");
    if (!isLambda(fn)) return null;
    return a.items.every((v, i) => truthy(callLambda(c, fn, [v, i, a])));
  });
  r.set("array.some", (c) => {
    const a = self3(c);
    if (!a) return null;
    const fn = c.arg(base3(c), "predicate");
    if (!isLambda(fn)) return null;
    return a.items.some((v, i) => truthy(callLambda(c, fn, [v, i, a])));
  });
}
function isLambda(v) {
  return Boolean(v && typeof v === "object" && v.__pine === "lambda");
}
function callLambda(c, fn, args) {
  return c.rt.callLambdaValue(fn, args, c.line);
}
function percentileLinear(values, percent) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  const rank2 = percent / 100 * (sorted.length - 1);
  const lower = Math.floor(rank2);
  const lo = sorted[lower];
  const hi = sorted[Math.ceil(rank2)];
  return lo + (hi - lo) * (rank2 - lower);
}
function percentileNearest(values, percent) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank2 = Math.ceil(percent / 100 * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank2 - 1))] ?? null;
}

// src/runtime/builtins/input.ts
function overridden(c) {
  const key = c.rt.inputKeyFor(c.id);
  if (!key) return { present: false };
  const inputs = c.rt.inputs;
  if (!Object.prototype.hasOwnProperty.call(inputs, key)) return { present: false };
  const raw = inputs[key];
  return { present: true, value: raw };
}
function numeric(c, index, name) {
  const override = overridden(c);
  if (override.present) {
    const v = toNum(override.value ?? null);
    if (v !== null) return v;
  }
  return numArg(c, index, name);
}
function registerInput(r) {
  r.set("input.int", (c) => {
    const override = overridden(c);
    if (override.present) {
      const v = toNum(override.value ?? null);
      if (v !== null) return Math.trunc(v);
    }
    return numeric(c, 0, "defval");
  });
  r.set("input.float", (c) => numeric(c, 0, "defval"));
  r.set("input.price", (c) => numeric(c, 0, "defval"));
  r.set("input.bool", (c) => {
    const override = overridden(c);
    if (override.present) return Boolean(override.value);
    return Boolean(c.arg(0, "defval"));
  });
  r.set("input.string", (c) => {
    const override = overridden(c);
    if (override.present && override.value !== null && override.value !== void 0) return toStr(override.value);
    return strArg(c, 0, "defval", "");
  });
  r.set("input.text_area", (c) => {
    const override = overridden(c);
    if (override.present) return toStr(override.value ?? "");
    return strArg(c, 0, "defval", "");
  });
  r.set("input.symbol", (c) => {
    const override = overridden(c);
    if (override.present) return toStr(override.value ?? "");
    return strArg(c, 0, "defval", "");
  });
  r.set("input.timeframe", (c) => {
    const override = overridden(c);
    if (override.present) return toStr(override.value ?? "");
    return strArg(c, 0, "defval", "");
  });
  r.set("input.session", (c) => {
    const override = overridden(c);
    if (override.present) return toStr(override.value ?? "");
    return strArg(c, 0, "defval", "");
  });
  r.set("input.time", (c) => numeric(c, 0, "defval"));
  r.set("input.color", (c) => {
    const override = overridden(c);
    if (override.present) return new PineColor(toStr(override.value ?? "#000000"));
    const value = c.arg(0, "defval");
    return value instanceof PineColor ? value : new PineColor(typeof value === "string" ? value : "#000000");
  });
  r.set("input.source", (c) => {
    const override = overridden(c);
    if (override.present) {
      const name = toStr(override.value ?? "close");
      return c.rt.seriesByName(name).get(0);
    }
    return c.arg(0, "defval");
  });
  r.set("input", (c) => {
    const override = overridden(c);
    const type = c.arg(2, "type");
    let typeName = typeof type === "string" ? type : "";
    if (!typeName) {
      const defExpr = c.argExpr(0, "defval");
      const identName = defExpr && defExpr.kind === "ident" ? defExpr.name : null;
      if (identName && c.rt.seriesByName(identName).known > 0) typeName = "source";
      else if (defExpr && defExpr.kind === "str") typeName = "string";
      else if (defExpr && defExpr.kind === "bool") typeName = "bool";
      else typeName = "float";
    }
    if (typeName === "source") {
      const name = override.present ? toStr(override.value) : null;
      if (name && name !== "") return c.rt.seriesByName(name).get(0);
      return c.arg(0, "defval");
    }
    if (override.present) {
      if (typeName === "bool") return Boolean(override.value);
      if (typeName === "string" || typeName === "symbol" || typeName === "timeframe" || typeName === "session") return toStr(override.value ?? "");
      const v = toNum(override.value ?? null);
      return v === null ? null : typeName === "int" ? Math.trunc(v) : v;
    }
    const defval = c.arg(0, "defval");
    const step = c.arg(3, "step");
    void step;
    if (typeName === "int" && typeof defval === "number") return Math.trunc(defval);
    return defval;
  });
  r.set("input.enum", (c) => {
    const override = overridden(c);
    if (override.present) return override.value ?? null;
    return c.arg(0, "defval");
  });
  void intArg;
}

// src/runtime/builtins/draw.ts
var DEFAULT_COLORS = ["#2196f3", "#ff9800", "#4caf50", "#f44336", "#9c27b0", "#00bcd4", "#ffeb3b", "#787b86"];
var colorCursor = 0;
function colorCss(v, fallback) {
  if (v instanceof PineColor) return v.css;
  if (typeof v === "string") return v;
  return fallback;
}
function styleOf(v, fallback) {
  if (v === "dashed" || v === "dotted" || v === "solid") return v;
  return fallback;
}
function plotRef(c) {
  return { __pine: "plot", callId: c.id };
}
function isPlotRef(v) {
  return Boolean(v && typeof v === "object" && v.__pine === "plot");
}
function registerDraw(r) {
  r.set("plot", (c) => {
    const rt = c.rt;
    const value = toNum(c.arg(0, "series"));
    const title = strArg(c, 1, "title", `Plot ${rt.sink.lines.size + 1}`);
    const fallbackColor = DEFAULT_COLORS[colorCursor++ % DEFAULT_COLORS.length];
    const color = colorCss(c.arg(2, "color"), fallbackColor);
    const width = intArg(c, 3, "linewidth", 1);
    if (rt.isV6 && c.argExpr(3, "linewidth") && width < 1) {
      throw new PineRuntimeError('The "linewidth" argument must be at least 1 (Pine v6 removed zero-width lines)', "SCRIPT_ERROR", {
        line: c.line
      });
    }
    const styleToken = c.arg(4, "style");
    const kind = mapPlotStyle(typeof styleToken === "string" ? styleToken : "line");
    const offset = intArg(c, 5, "offset", 0);
    const forceOverlay = c.arg(11, "force_overlay");
    const rec = rt.sink.ensureLine(c.id, {
      title,
      kind,
      color,
      width,
      lineStyle: "solid",
      offset,
      visible: true
    });
    rec.values[rt.barIndex] = value;
    rec.colors[rt.barIndex] = c.argExpr(2, "color") ? color : null;
    if (forceOverlay !== null && forceOverlay !== void 0) rec.visible = true;
    return plotRef(c);
  });
  r.set("plotshape", (c) => {
    const rt = c.rt;
    const series = c.arg(0, "series");
    const title = strArg(c, 1, "title", `Shape ${rt.sink.markers.size + 1}`);
    const styleToken = c.arg(2, "style");
    const locationToken = c.arg(3, "location");
    const color = colorCss(c.arg(4, "color"), "#2196f3");
    const text = c.arg(5, "text");
    const sizeToken = c.arg(7, "size");
    const rec = rt.sink.ensureMarkers(c.id, title);
    const bar = rt.bar;
    if (!bar) return null;
    const truthy2 = series !== null && series !== false;
    if (!truthy2) {
      rec.points[rt.barIndex] = null;
      return null;
    }
    const point = {
      time: bar.time,
      position: mapLocation(typeof locationToken === "string" ? locationToken : "aboveBar"),
      shape: mapShape(typeof styleToken === "string" ? styleToken : "circle"),
      color
    };
    if (text !== null) point.text = toStr(text);
    if (typeof sizeToken === "string") {
      const size = sizeToken;
      if (size) point.size = size;
    }
    rec.points[rt.barIndex] = point;
    return plotRef(c);
  });
  r.set("plotchar", (c) => {
    const rt = c.rt;
    const series = c.arg(0, "series");
    const title = strArg(c, 1, "title", `Char ${rt.sink.markers.size + 1}`);
    const char = c.arg(2, "char");
    const locationToken = c.arg(3, "location");
    const color = colorCss(c.arg(4, "color"), "#2196f3");
    const rec = rt.sink.ensureMarkers(c.id, title);
    const bar = rt.bar;
    if (!bar) return null;
    if (series === null || series === false) {
      rec.points[rt.barIndex] = null;
      return null;
    }
    rec.points[rt.barIndex] = {
      time: bar.time,
      position: mapLocation(typeof locationToken === "string" ? locationToken : "aboveBar"),
      shape: "circle",
      color,
      ...char !== null ? { text: toStr(char) } : {}
    };
    return plotRef(c);
  });
  r.set("plotarrow", (c) => {
    const rt = c.rt;
    const series = c.arg(0, "series");
    const title = strArg(c, 1, "title", `Arrow ${rt.sink.markers.size + 1}`);
    const upColor = colorCss(c.arg(2, "colorup"), "#4caf50");
    const downColor = colorCss(c.arg(3, "colordown"), "#f44336");
    const bar = rt.bar;
    if (!bar) return null;
    const value = toNum(series);
    const rec = rt.sink.ensureMarkers(c.id, title);
    if (value === null || value === 0) {
      rec.points[rt.barIndex] = null;
      return null;
    }
    rec.points[rt.barIndex] = {
      time: bar.time,
      position: value > 0 ? "belowBar" : "aboveBar",
      shape: value > 0 ? "arrowUp" : "arrowDown",
      color: value > 0 ? upColor : downColor
    };
    return plotRef(c);
  });
  const candlePlot = (kind) => (c) => {
    const rt = c.rt;
    const open2 = toNum(c.arg(0, "open"));
    const high = toNum(c.arg(1, "high"));
    const low = toNum(c.arg(2, "low"));
    const close = toNum(c.arg(3, "close"));
    const record = rt.sink.ensureCandles(c.id, strArg(c, 4, "title", kind === "bars" ? "Bars" : "Candles"), kind);
    const color = colorCss(c.arg(5, "color"), null) || null;
    const wickColor = colorCss(c.arg(6, "wickcolor"), null) || color;
    const borderColor = colorCss(c.arg(7, "bordercolor"), null) || null;
    record.points[rt.barIndex] = open2 === null || high === null || low === null || close === null ? null : { open: open2, high, low, close, color, borderColor, wickColor };
    return null;
  };
  r.set("plotcandle", candlePlot("candles"));
  r.set("plotbar", candlePlot("bars"));
  r.set("hline", (c) => {
    const rt = c.rt;
    const price = toNum(c.arg(0, "price"));
    if (price === null) return null;
    const title = strArg(c, 1, "title", `HLine ${rt.sink.hlines.size + 1}`);
    const color = colorCss(c.arg(2, "color"), "#787b86");
    const styleToken = c.arg(3, "linestyle");
    const width = intArg(c, 4, "linewidth", 1);
    if (!rt.sink.hlines.has(c.id)) {
      rt.sink.hlines.set(c.id, {
        callId: c.id,
        title,
        price,
        color,
        lineStyle: styleOf(typeof styleToken === "string" ? styleToken : null, "solid"),
        width
      });
    }
    return { __pine: "hline" };
  });
  r.set("fill", (c) => {
    const rt = c.rt;
    const from = c.arg(0, "plot1");
    const to = c.arg(1, "plot2");
    if (!isPlotRef(from) || !isPlotRef(to)) {
      c.warn("fill requires two plot references; the call is ignored");
      return null;
    }
    const fromId = from.callId;
    const toId = to.callId;
    const colorArg = c.arg(2, "color");
    const color = colorArg instanceof PineColor ? colorArg.css : "rgba(33, 150, 243, 0.2)";
    const rec = rt.sink.ensureFill(c.id, fromId, toId, color);
    rec.colors[rt.barIndex] = colorArg instanceof PineColor ? colorArg.css : null;
    return null;
  });
  r.set("bgcolor", (c) => {
    const rt = c.rt;
    const title = strArg(c, 1, "title", `BgColor ${rt.sink.backgrounds.size + 1}`);
    const rec = rt.sink.ensureBackground(c.id, title);
    const color = c.arg(0, "color");
    rec.colors[rt.barIndex] = color instanceof PineColor ? color.css : color === null ? null : toStr(color);
    return null;
  });
  r.set("barcolor", (c) => {
    const rt = c.rt;
    const color = c.arg(0, "color");
    const offset = intArg(c, 3, "offset", 0);
    rt.sink.barColors[rt.barIndex + offset] = color instanceof PineColor ? color.css : color === null ? null : toStr(color);
    return null;
  });
  r.set("alert", (c) => {
    const rt = c.rt;
    const message = c.arg(0, "message");
    const bar = rt.bar;
    if (!bar) return null;
    rt.pendingAlerts.push({
      id: `alert-${c.id}-${rt.barIndex}`,
      message: message === null ? "" : toStr(message),
      time: bar.time,
      barIndex: rt.barIndex,
      ...c.arg(1, "freq") !== null ? { freq: toStr(c.arg(1, "freq")) } : {}
    });
    return null;
  });
  r.set("alertcondition", (c) => {
    const rt = c.rt;
    const cond = c.arg(0, "condition");
    if (cond === null || cond === false) return null;
    const bar = rt.bar;
    if (!bar) return null;
    const title = strArg(c, 1, "title", "alertcondition");
    rt.pendingAlerts.push({
      id: `alertcondition-${c.id}-${rt.barIndex}`,
      title,
      message: strArg(c, 2, "message", title),
      time: bar.time,
      barIndex: rt.barIndex
    });
    return null;
  });
}
function mapPlotStyle(token) {
  switch (token) {
    case "style_stepline":
    case "style_stepline_diamond":
    case "stepline":
    case "stepline_diamond":
    case "steplinebr":
      return "step";
    // The `*br` variants only differ by suppressing the line across gaps, which the
    // host model cannot express, so they fall back to their base style.
    case "linebr":
      return "line";
    case "areabr":
      return "area";
    case "style_histogram":
    case "histogram":
      return "histogram";
    case "style_area":
    case "style_areabr":
    case "area":
      return "area";
    case "style_cross":
    case "cross":
      return "cross";
    case "style_circles":
    case "circles":
      return "circles";
    case "style_columns":
    case "columns":
      return "columns";
    default:
      return "line";
  }
}
function mapLocation(token) {
  switch (token) {
    case "belowBar":
    case "belowbar":
    case "bottom":
      return "belowBar";
    case "inBar":
    case "absolute":
      return "inBar";
    default:
      return "aboveBar";
  }
}
function mapShape(token) {
  switch (token) {
    case "arrowUp":
    case "arrowup":
    case "labelup":
      return "arrowUp";
    case "arrowDown":
    case "arrowdown":
    case "labeldown":
      return "arrowDown";
    case "square":
      return "square";
    case "diamond":
      return "diamond";
    case "triangleup":
    case "triangleUp":
      return "triangleUp";
    case "triangledown":
    case "triangleDown":
      return "triangleDown";
    case "flag":
      return "flag";
    case "cross":
    case "xcross":
      return "cross";
    default:
      return "circle";
  }
}

// src/runtime/builtins/request.ts
function registerRequest(r) {
  r.set("request.security", (c) => {
    const symbol = toStr(c.arg(0, "symbol") ?? "");
    const timeframe = toStr(c.arg(1, "timeframe") ?? "");
    const expr = c.argExpr(2, "expression");
    if (!expr) return null;
    const lookaheadArg = c.arg(4, "lookahead");
    const lookahead = lookaheadArg === null || lookaheadArg === void 0 ? c.rt.version <= 2 : typeof lookaheadArg === "string" && lookaheadArg.includes("on");
    return c.rt.switchContext(c.id, symbol, timeframe, expr, lookahead);
  });
  const naWithWarning = (name) => (c) => {
    c.warn(`${name} is not supported by this engine and returns na`);
    return null;
  };
  r.set("request.footprint", naWithWarning("request.footprint"));
  r.set("request.security_lower_tf", (c) => {
    const symbol = toStr(c.arg(0, "symbol") ?? "");
    const timeframe = toStr(c.arg(1, "timeframe") ?? "");
    const expr = c.argExpr(2, "expression");
    if (!expr) return null;
    return c.rt.lowerTfValues(c.id, symbol, timeframe, expr);
  });
  r.set("request.currency_rate", naWithWarning("request.currency_rate"));
  r.set("request.dividends", naWithWarning("request.dividends"));
  r.set("request.splits", naWithWarning("request.splits"));
  r.set("request.earnings", naWithWarning("request.earnings"));
  r.set("request.financial", naWithWarning("request.financial"));
  r.set("request.quandl", naWithWarning("request.quandl"));
  r.set("request.economic", naWithWarning("request.economic"));
  r.set("request.seed", naWithWarning("request.seed"));
}

// src/runtime/builtins/strategy.ts
function legacyDirection(c, value) {
  if (typeof value === "boolean") {
    if (c.rt.version <= 4) return value ? 1 : -1;
    throw new PineRuntimeError(
      "The second argument of strategy.entry()/strategy.order() is strategy.long or strategy.short since Pine v5, not a bool",
      "TYPE_ERROR",
      { line: c.line }
    );
  }
  return toNum(value) ?? 0;
}
function mintick(c) {
  return c.rt.market.symbolInfo?.mintick ?? 0.01;
}
function registerStrategy(r) {
  const declaration = () => null;
  r.set("indicator", declaration);
  r.set("study", declaration);
  r.set("strategy", declaration);
  r.set("library", declaration);
  r.set("strategy.entry", (c) => {
    const broker = c.rt.broker;
    if (!broker) {
      c.warn("strategy.entry in an indicator script is ignored");
      return null;
    }
    const id = strArg(c, 0, "id", "entry");
    const direction = legacyDirection(c, c.arg(1, "direction"));
    if (direction === 0) return null;
    const qty = toNum(c.arg(2, "qty"));
    const limit = toNum(c.arg(3, "limit"));
    const stop = toNum(c.arg(4, "stop"));
    const comment = c.arg(7, "comment");
    broker.entry({
      direction,
      id,
      qty: qty !== null && qty > 0 ? qty : null,
      limit,
      stop,
      ...comment !== null ? { comment: toStr(comment) } : {},
      mintick: mintick(c)
    });
    return null;
  });
  r.set("strategy.order", (c) => {
    const broker = c.rt.broker;
    if (!broker) return null;
    const id = strArg(c, 0, "id", "order");
    const direction = toNum(c.arg(1, "direction")) ?? 0;
    if (direction === 0) return null;
    const qty = toNum(c.arg(2, "qty"));
    const limit = toNum(c.arg(3, "limit"));
    const stop = toNum(c.arg(4, "stop"));
    const comment = c.arg(7, "comment");
    broker.order({
      direction,
      id,
      qty: qty !== null && qty > 0 ? qty : null,
      limit,
      stop,
      ...comment !== null ? { comment: toStr(comment) } : {},
      mintick: mintick(c)
    });
    return null;
  });
  r.set("strategy.close", (c) => {
    const broker = c.rt.broker;
    if (!broker) return null;
    const entryId = strArg(c, 0, "id", "");
    const comment = c.arg(1, "comment");
    const qty = numArg(c, 2, "qty");
    const qtyPercent = numArg(c, 3, "qty_percent");
    broker.close(entryId || null, comment === null ? void 0 : toStr(comment), qty, qtyPercent);
    return null;
  });
  r.set("strategy.close_all", (c) => {
    const broker = c.rt.broker;
    if (!broker) return null;
    const comment = c.arg(0, "comment");
    broker.close(null, comment === null ? void 0 : toStr(comment), null, null, "Close All");
    return null;
  });
  r.set("strategy.exit", (c) => {
    const broker = c.rt.broker;
    if (!broker) return null;
    const id = strArg(c, 0, "id", "exit");
    const fromEntry = c.arg(1, "from_entry");
    const pending = broker.position === 0 ? broker.pendingEntry(fromEntry === null ? void 0 : toStr(fromEntry)) : null;
    const direction = broker.position > 0 ? -1 : broker.position < 0 ? 1 : pending ? -pending.direction : 0;
    if (direction === 0) return null;
    const limitAbs = numArg(c, 5, "limit");
    const stopAbs = numArg(c, 7, "stop");
    const profitTicks = numArg(c, 4, "profit");
    const lossTicks = numArg(c, 6, "loss");
    const entryPrice = broker.position !== 0 ? broker.avgPrice : null;
    const tick = mintick(c);
    const closingLong = direction === -1;
    const profitLevel = profitTicks !== null && entryPrice !== null ? closingLong ? entryPrice + profitTicks * tick : entryPrice - profitTicks * tick : null;
    const lossLevel = lossTicks !== null && entryPrice !== null ? closingLong ? entryPrice - lossTicks * tick : entryPrice + lossTicks * tick : null;
    let limit = limitAbs;
    let stop = stopAbs;
    if (limitAbs !== null && profitLevel !== null) {
      limit = c.rt.isV6 ? closingLong ? Math.min(limitAbs, profitLevel) : Math.max(limitAbs, profitLevel) : limitAbs;
    } else {
      limit = limitAbs ?? profitLevel;
    }
    if (stopAbs !== null && lossLevel !== null) {
      stop = c.rt.isV6 ? closingLong ? Math.max(stopAbs, lossLevel) : Math.min(stopAbs, lossLevel) : stopAbs;
    } else {
      stop = stopAbs ?? lossLevel;
    }
    const comment = c.arg(12, "comment");
    const exitQty = numArg(c, 2, "qty");
    const exitQtyPercent = numArg(c, 3, "qty_percent");
    const trailPrice = numArg(c, 8, "trail_price");
    const trailPoints = numArg(c, 9, "trail_points");
    const trailOffset = numArg(c, 10, "trail_offset");
    if (trailPoints !== null || trailPrice !== null) {
      broker.setTrailing({
        id,
        direction,
        points: trailPoints,
        price: trailPrice,
        offset: trailOffset,
        tick,
        active: false,
        best: null,
        qty: exitQty,
        qtyPercent: exitQtyPercent,
        ...fromEntry !== null ? { fromEntry: toStr(fromEntry) } : {}
      });
      if (limit === null && stop === null) return null;
    }
    if (entryPrice === null && (profitTicks !== null || lossTicks !== null)) {
      broker.deferExit({
        id,
        direction,
        ...fromEntry !== null ? { fromEntry: toStr(fromEntry) } : {},
        profitTicks,
        lossTicks,
        limitAbs: limit,
        stopAbs: stop,
        tick,
        qty: exitQty ?? (pending?.qty ?? null),
        qtyPercent: exitQtyPercent,
        ...comment !== null ? { comment: toStr(comment) } : {}
      });
      return null;
    }
    broker.entry({
      direction,
      id,
      qty: exitQty ?? (Math.abs(broker.position) || pending?.qty || 1),
      limit,
      stop,
      // `profit` + `loss` is an OCA bracket: the first leg the bar reaches wins.
      ...limit !== null && stop !== null ? { oco: true } : {},
      ...comment !== null ? { comment: toStr(comment) } : {},
      ...fromEntry !== null ? { fromEntry: toStr(fromEntry) } : {},
      mintick: tick,
      ...exitQtyPercent !== null ? { qtyPercent: exitQtyPercent } : {}
    });
    return null;
  });
  r.set("strategy.cancel", (c) => {
    const id = c.arg(0, "id");
    const broker = c.rt.broker;
    if (!broker) return null;
    if (id === null) return null;
    broker.cancel(toStr(id));
    return null;
  });
  r.set("strategy.cancel_all", (c) => {
    c.rt.broker?.cancelAll();
    return null;
  });
  r.set("strategy.risk.allow_entry_in", (c) => {
    const direction = c.arg(0, "value");
    const broker = c.rt.broker;
    if (broker) broker.allowedDirection = direction === "long" ? "long" : direction === "short" ? "short" : "all";
    return null;
  });
  r.set("strategy.risk.max_intraday_loss", (c) => {
    const value = numArg(c, 0, "value");
    const broker = c.rt.broker;
    if (broker && value !== null) broker.maxIntradayLoss = Math.abs(value);
    return null;
  });
  r.set("strategy.risk.max_position_size", (c) => {
    const qty = numArg(c, 0, "qty");
    const broker = c.rt.broker;
    if (broker && qty !== null) broker.maxPositionSize = Math.abs(qty);
    return null;
  });
}

// src/runtime/builtins/misc.ts
function registerMisc(r) {
  const rejectBool = (c, fn) => {
    if (c.rt.isV6 && typeof c.arg(0) === "boolean") {
      throw new PineRuntimeError(`'${fn}' does not accept a 'bool' argument in Pine v6`, "TYPE_ERROR");
    }
  };
  r.set("na", (c) => {
    rejectBool(c, "na");
    return c.arg(0) === null;
  });
  r.set("nz", (c) => {
    rejectBool(c, "nz");
    const v = c.arg(0);
    const fallback = c.arg(1, "y");
    if (v === null || typeof v === "number" && Number.isNaN(v)) return fallback ?? 0;
    return v;
  });
  r.set("fixnan", (c) => {
    rejectBool(c, "fixnan");
    const v = c.arg(0);
    const st = c.state(() => ({ last: null }));
    if (v !== null && !(typeof v === "number" && Number.isNaN(v))) st.last = v;
    return st.last;
  });
  r.set("timestamp", (c) => {
    const positional = c.args.filter((a) => a.name === void 0).length;
    if (positional >= 6 || c.has("year")) {
      const y = numArg(c, 0, "year") ?? 1970;
      const mo = numArg(c, 1, "month") ?? 1;
      const d = numArg(c, 2, "day") ?? 1;
      const h = numArg(c, 3, "hour") ?? 0;
      const mi = numArg(c, 4, "minute") ?? 0;
      const s2 = numArg(c, 5, "second") ?? 0;
      return Date.UTC(y, mo - 1, d, h, mi, s2);
    }
    const raw = c.arg(0, "dateString");
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof raw === "number") return raw;
    return null;
  });
  r.set("timenow", () => Date.now());
  r.set("time", (c) => {
    if (c.args.length === 0) return c.rt.valueByName("time");
    c.warn("time(timeframe, session) is evaluated as the bar time by this engine");
    return c.rt.valueByName("time");
  });
  r.set("color.new", (c) => {
    const base3 = c.arg(0, "color");
    const transp = numArg(c, 1, "transp") ?? 0;
    const css2 = base3 instanceof PineColor ? base3.css : typeof base3 === "string" ? base3 : "#000000";
    const rgba = parseCssColor(css2);
    if (!rgba) return new PineColor(css2);
    return new PineColor(`rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${round32(rgba.a * (1 - Math.max(0, Math.min(100, transp)) / 100))})`);
  });
  r.set("color.rgb", (c) => {
    const red = numArg(c, 0, "red") ?? 0;
    const green = numArg(c, 1, "green") ?? 0;
    const blue = numArg(c, 2, "blue") ?? 0;
    const transp = numArg(c, 3, "transp") ?? 0;
    return colorFromRgba(red, green, blue, transp);
  });
  r.set("color.from_gradient", (c) => {
    const value = numArg(c, 0, "value");
    const bottom = numArg(c, 1, "bottom_value") ?? 0;
    const top = numArg(c, 2, "top_value") ?? 100;
    const bottomColor = c.arg(3, "bottom_color");
    const topColor = c.arg(4, "top_color");
    if (value === null) return null;
    if (top === bottom) return bottomColor instanceof PineColor ? bottomColor : null;
    const t = Math.max(0, Math.min(1, (value - bottom) / (top - bottom)));
    const a = parseCssColor(bottomColor instanceof PineColor ? bottomColor.css : "#000000");
    const b = parseCssColor(topColor instanceof PineColor ? topColor.css : "#ffffff");
    if (!a || !b) return null;
    const mix = (x, y) => Math.round(x + (y - x) * t);
    return colorFromRgba(mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b), (1 - (a.a + (b.a - a.a) * t)) * 100);
  });
  const channel = (pick) => (c) => {
    const value = c.arg(0, "color");
    const css2 = value instanceof PineColor ? value.css : typeof value === "string" ? value : null;
    if (css2 === null) return null;
    const rgba = parseCssColor(css2);
    if (!rgba) return null;
    return Math.round(pick(rgba));
  };
  r.set("color.r", channel((c) => c.r));
  r.set("color.g", channel((c) => c.g));
  r.set("color.b", channel((c) => c.b));
  r.set("color.t", channel((c) => (1 - c.a) * 100));
  r.set("runtime.error", (c) => {
    throw new PineRuntimeError(toStr(c.arg(0, "message") ?? "runtime.error"), "SCRIPT_ERROR", { line: c.line });
  });
  r.set("runtime.log", (c) => {
    c.warn(toStr(c.arg(0, "message") ?? ""));
    return null;
  });
  r.set("max_bars_back", () => null);
  r.set("plot_style", () => null);
  r.set("tostring", (c) => toStr(c.arg(0) ?? null));
}
function round32(x) {
  return Math.round(x * 1e3) / 1e3;
}

// src/runtime/collections.ts
var PineMatrix = class _PineMatrix {
  __pine = "matrix";
  /** Row-major storage: `rows[r][c]`. */
  rows;
  cols;
  constructor(rows = 0, cols = 0, fill = null) {
    this.cols = Math.max(0, Math.trunc(cols));
    this.rows = Array.from(
      { length: Math.max(0, Math.trunc(rows)) },
      () => Array.from({ length: this.cols }, () => fill)
    );
  }
  get rowCount() {
    return this.rows.length;
  }
  get(row, col) {
    return this.rows[row]?.[col] ?? null;
  }
  set(row, col, value) {
    if (this.rows[row]) this.rows[row][col] = value;
  }
  clone() {
    const m = new _PineMatrix(0, 0);
    m.cols = this.cols;
    m.rows = this.rows.map((r) => r.slice());
    return m;
  }
  /** All elements in row-major order (na included). */
  flat() {
    return this.rows.flat();
  }
  /** Numeric elements only — statistics skip `na`, as Pine does. */
  numbers() {
    const out = [];
    for (const v of this.flat()) {
      const n2 = toNum(v);
      if (n2 !== null && Number.isFinite(n2)) out.push(n2);
    }
    return out;
  }
  toStr() {
    return `matrix(${this.rowCount}x${this.cols})`;
  }
};
function encodeKey(key) {
  if (isNa(key)) return "na:";
  if (typeof key === "number") return `num:${key}`;
  if (typeof key === "string") return `str:${key}`;
  if (typeof key === "boolean") return `bool:${key}`;
  return `obj:${toStr(key)}`;
}
var PineMap = class _PineMap {
  constructor(keyType = "string", valueType = "float") {
    this.keyType = keyType;
    this.valueType = valueType;
  }
  keyType;
  valueType;
  __pine = "map";
  entries = /* @__PURE__ */ new Map();
  put(key, value) {
    this.entries.set(encodeKey(key), { key, value });
  }
  get(key) {
    return this.entries.get(encodeKey(key))?.value ?? null;
  }
  contains(key) {
    return this.entries.has(encodeKey(key));
  }
  remove(key) {
    this.entries.delete(encodeKey(key));
  }
  keysArray() {
    return new PineArray([...this.entries.values()].map((e) => e.key), this.keyType);
  }
  valuesArray() {
    return new PineArray([...this.entries.values()].map((e) => e.value), this.valueType);
  }
  get size() {
    return this.entries.size;
  }
  clone() {
    const m = new _PineMap(this.keyType, this.valueType);
    for (const [k, e] of this.entries) m.entries.set(k, { ...e });
    return m;
  }
  toStr() {
    return `map(${this.entries.size})`;
  }
};

// src/runtime/linalg.ts
function zeros(rows, cols, fill = 0) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}
function identity(n2) {
  const out = zeros(n2, n2);
  for (let i = 0; i < n2; i++) out[i][i] = 1;
  return out;
}
function rowsOf(a) {
  return a.length;
}
function colsOf(a) {
  return a[0]?.length ?? 0;
}
function transpose(a) {
  const r = rowsOf(a);
  const c = colsOf(a);
  const out = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = a[i][j];
  return out;
}
function multiply(a, b) {
  const n2 = rowsOf(a);
  const k = colsOf(a);
  if (k !== rowsOf(b)) return null;
  const m = colsOf(b);
  const out = zeros(n2, m);
  for (let i = 0; i < n2; i++) {
    for (let j = 0; j < m; j++) {
      let sum2 = 0;
      for (let t = 0; t < k; t++) sum2 += a[i][t] * b[t][j];
      out[i][j] = sum2;
    }
  }
  return out;
}
function determinant(a) {
  const n2 = rowsOf(a);
  if (n2 === 0 || colsOf(a) !== n2) return NaN;
  const m = a.map((row) => row.slice());
  let det = 1;
  for (let col = 0; col < n2; col++) {
    let pivot = col;
    for (let r = col + 1; r < n2; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    const pv = m[pivot][col];
    if (Math.abs(pv) < 1e-12) return 0;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
      det = -det;
    }
    det *= pv;
    for (let r = col + 1; r < n2; r++) {
      const factor = m[r][col] / pv;
      for (let c = col; c < n2; c++) m[r][c] = m[r][c] - factor * m[col][c];
    }
  }
  return det;
}
function inverse(a) {
  const n2 = rowsOf(a);
  if (n2 === 0 || colsOf(a) !== n2) return null;
  const m = a.map((row, i) => [...row, ...identity(n2)[i]]);
  for (let col = 0; col < n2; col++) {
    let pivot = col;
    for (let r = col + 1; r < n2; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    const pv = m[pivot][col];
    if (Math.abs(pv) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }
    for (let c = 0; c < 2 * n2; c++) m[col][c] = m[col][c] / pv;
    for (let r = 0; r < n2; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n2; c++) m[r][c] = m[r][c] - factor * m[col][c];
    }
  }
  return m.map((row) => row.slice(n2));
}
function rank(a) {
  const m = a.map((row) => row.slice());
  const r = rowsOf(m);
  const c = colsOf(m);
  let maxAbs = 0;
  for (const row of m) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  const tol = Math.max(1e-12, maxAbs * 1e-10);
  let rankCount = 0;
  for (let col = 0; col < c && rankCount < r; col++) {
    let pivot = rankCount;
    for (let i = rankCount; i < r; i++) {
      if (Math.abs(m[i][col]) > Math.abs(m[pivot][col])) pivot = i;
    }
    if (Math.abs(m[pivot][col]) <= tol) continue;
    const tmp = m[pivot];
    m[pivot] = m[rankCount];
    m[rankCount] = tmp;
    const pv = m[rankCount][col];
    for (let cc = col; cc < c; cc++) m[rankCount][cc] = m[rankCount][cc] / pv;
    for (let i = 0; i < r; i++) {
      if (i === rankCount) continue;
      const factor = m[i][col];
      if (factor === 0) continue;
      for (let cc = col; cc < c; cc++) m[i][cc] = m[i][cc] - factor * m[rankCount][cc];
    }
    rankCount++;
  }
  return rankCount;
}
function jacobiEigen(input) {
  const n2 = rowsOf(input);
  const a = input.map((row) => row.slice());
  const v = identity(n2);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n2; i++) for (let j = i + 1; j < n2; j++) off += Math.abs(a[i][j]);
    if (off < 1e-12) break;
    for (let p = 0; p < n2 - 1; p++) {
      for (let q = p + 1; q < n2; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s2 = t * c;
        for (let k = 0; k < n2; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s2 * akq;
          a[k][q] = s2 * akp + c * akq;
        }
        for (let k = 0; k < n2; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s2 * aqk;
          a[q][k] = s2 * apk + c * aqk;
        }
        for (let k = 0; k < n2; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s2 * vkq;
          v[k][q] = s2 * vkp + c * vkq;
        }
      }
    }
  }
  const values = Array.from({ length: n2 }, (_, i) => a[i][i]);
  return { values, vectors: v };
}
function eigenvalues(a) {
  const n2 = rowsOf(a);
  if (n2 === 0 || colsOf(a) !== n2) return [];
  if (n2 === 1) return [a[0][0]];
  if (n2 === 2) {
    const [a11, a12] = [a[0][0], a[0][1]];
    const [a21, a22] = [a[1][0], a[1][1]];
    const tr = a11 + a22;
    const det = a11 * a22 - a12 * a21;
    const disc = tr * tr - 4 * det;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      return [(tr + sq) / 2, (tr - sq) / 2];
    }
    return [tr / 2, tr / 2];
  }
  if (isSymmetric(a)) return jacobiEigen(a).values.sort((x, y) => y - x);
  let m = a.map((row) => row.slice());
  for (let iter = 0; iter < 500; iter++) {
    const { q, r } = qr(m);
    m = multiply(r, q) ?? m;
    let off = 0;
    for (let i = 1; i < n2; i++) for (let j = 0; j < i; j++) off += Math.abs(m[i][j]);
    if (off < 1e-10) break;
  }
  const diag = Array.from({ length: n2 }, (_, i) => m[i][i]);
  return diag.sort((x, y) => y - x);
}
function qr(a) {
  const n2 = rowsOf(a);
  const m = colsOf(a);
  const q = zeros(n2, m);
  const r = zeros(m, m);
  for (let j = 0; j < m; j++) {
    let v = Array.from({ length: n2 }, (_, i) => a[i][j]);
    for (let i = 0; i < j; i++) {
      const qi = Array.from({ length: n2 }, (_, k) => q[k][i]);
      const dot = qi.reduce((acc, val, k) => acc + val * v[k], 0);
      r[i][j] = dot;
      v = v.map((val, k) => val - dot * qi[k]);
    }
    const norm = Math.sqrt(v.reduce((acc, val) => acc + val * val, 0)) || 1;
    for (let i = 0; i < n2; i++) q[i][j] = v[i] / norm;
    r[j][j] = norm;
  }
  return { q, r };
}
function eigenvectors(a) {
  const n2 = rowsOf(a);
  if (n2 === 0) return [];
  const values = eigenvalues(a);
  const columns = [];
  for (const lambda of values) {
    const found = nullspace(a, lambda);
    let vec = found ?? Array.from({ length: n2 }, (_, i) => i === columns.length % n2 ? 1 : 0);
    const norm = Math.sqrt(vec.reduce((acc, val) => acc + val * val, 0)) || 1;
    const idx = vec.reduce((best, val, i) => Math.abs(val) > Math.abs(vec[best]) ? i : best, 0);
    const sign = vec[idx] < 0 ? -1 : 1;
    vec = vec.map((val) => val / norm * sign);
    columns.push(vec);
  }
  const out = zeros(n2, columns.length);
  columns.forEach((col, j) => col.forEach((val, i) => out[i][j] = val));
  return out;
}
function nullspace(a, lambda) {
  const n2 = rowsOf(a);
  const m = a.map((row, i) => row.map((v, j) => v - (i === j ? lambda : 0)));
  const mat = m.map((row) => row.slice());
  const pivotCols = [];
  let r = 0;
  for (let c = 0; c < n2 && r < n2; c++) {
    let pivot = r;
    for (let i = r; i < n2; i++) {
      if (Math.abs(mat[i][c]) > Math.abs(mat[pivot][c])) pivot = i;
    }
    if (Math.abs(mat[pivot][c]) < 1e-9) continue;
    const tmp = mat[pivot];
    mat[pivot] = mat[r];
    mat[r] = tmp;
    const pv = mat[r][c];
    for (let cc = 0; cc < n2; cc++) mat[r][cc] = mat[r][cc] / pv;
    for (let i = 0; i < n2; i++) {
      if (i === r) continue;
      const factor = mat[i][c];
      if (factor === 0) continue;
      for (let cc = 0; cc < n2; cc++) mat[i][cc] = mat[i][cc] - factor * mat[r][cc];
    }
    pivotCols.push(c);
    r++;
  }
  const free = Array.from({ length: n2 }, (_, i) => i).filter((c) => !pivotCols.includes(c));
  if (free.length === 0) return null;
  const freeCol = free[0];
  const vec = Array.from({ length: n2 }, () => 0);
  vec[freeCol] = 1;
  pivotCols.forEach((c, i) => {
    vec[c] = -mat[i][freeCol];
  });
  return vec;
}
function pseudoInverse(a) {
  const r = rowsOf(a);
  const c = colsOf(a);
  if (r === 0 || c === 0) return [];
  const ata = multiply(transpose(a), a);
  const { values, vectors } = jacobiEigen(ata);
  const maxValue = Math.max(...values.map(Math.abs), 0);
  const tol = Math.max(1e-12, maxValue * 1e-12);
  const invDiag = values.map((v) => Math.abs(v) > tol ? 1 / v : 0);
  const vd = vectors.map((row) => row.map((val, j) => val * invDiag[j]));
  const inner = multiply(vd, transpose(vectors));
  const out = multiply(inner, transpose(a));
  return out ?? [];
}
function trace(a) {
  const n2 = Math.min(rowsOf(a), colsOf(a));
  let sum2 = 0;
  for (let i = 0; i < n2; i++) sum2 += a[i][i];
  return sum2;
}
function isSymmetric(a) {
  const n2 = rowsOf(a);
  if (colsOf(a) !== n2) return false;
  for (let i = 0; i < n2; i++) {
    for (let j = i + 1; j < n2; j++) {
      const x = a[i][j];
      const y = a[j][i];
      if (Math.abs(x - y) > 1e-12 * Math.max(1, Math.abs(x), Math.abs(y))) return false;
    }
  }
  return true;
}
function kron(a, b) {
  const ra = rowsOf(a);
  const ca = colsOf(a);
  const rb = rowsOf(b);
  const cb = colsOf(b);
  const out = zeros(ra * rb, ca * cb);
  for (let i = 0; i < ra; i++) {
    for (let j = 0; j < ca; j++) {
      const factor = a[i][j];
      for (let k = 0; k < rb; k++) {
        for (let l = 0; l < cb; l++) {
          out[i * rb + k][j * cb + l] = factor * b[k][l];
        }
      }
    }
  }
  return out;
}
function matrixPower(a, power) {
  const n2 = rowsOf(a);
  if (colsOf(a) !== n2) return null;
  let exp = Math.trunc(power);
  if (exp < 0) {
    const inv = inverse(a);
    if (!inv) return null;
    return matrixPower(inv, -exp);
  }
  let result = identity(n2);
  let base3 = a.map((row) => row.slice());
  while (exp > 0) {
    if (exp & 1) result = multiply(result, base3);
    base3 = multiply(base3, base3);
    exp >>= 1;
  }
  return result;
}

// src/runtime/builtins/matrix.ts
function self(c) {
  const v = c.receiver !== void 0 ? c.receiver : c.arg(0, "id");
  return v instanceof PineMatrix ? v : null;
}
function base(c) {
  return c.receiver !== void 0 ? 0 : 1;
}
function extra(c, k, name) {
  return c.arg(base(c) + k, name);
}
function extraNum(c, k, name) {
  return toNum(extra(c, k, name));
}
function extraInt(c, k, name, def) {
  return intArg(c, base(c) + k, name, def);
}
function toNumbers(m) {
  return m.rows.map((row) => row.map((v) => toNum(v) ?? NaN));
}
function fromNumbers(a) {
  const m = new PineMatrix(0, 0);
  m.cols = a[0]?.length ?? 0;
  m.rows = a.map((row) => row.map((v) => Number.isNaN(v) ? null : v));
  return m;
}
function round(x) {
  return Number.isFinite(x) ? Math.round(x * 1e10) / 1e10 : x;
}
function arrayToValues(a) {
  return a.items.slice();
}
function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function mode(values) {
  const counts = /* @__PURE__ */ new Map();
  let best = NaN;
  let bestCount = 0;
  for (const v of values) {
    const n2 = (counts.get(v) ?? 0) + 1;
    counts.set(v, n2);
    if (n2 > bestCount) {
      bestCount = n2;
      best = v;
    }
  }
  return best;
}
function registerMatrix(r) {
  r.set("matrix.new", (c) => {
    const rows = intArg(c, 0, "rows", 0);
    const cols = intArg(c, 1, "columns", 0);
    const init = c.arg(2, "initial_value");
    return new PineMatrix(rows, cols, init);
  });
  r.set("matrix.copy", (c) => {
    const m = self(c);
    return m ? m.clone() : null;
  });
  r.set("matrix.get", (c) => {
    const m = self(c);
    if (!m) return null;
    const row = extraNum(c, 0, "row");
    const col = extraNum(c, 1, "column");
    if (row === null || col === null) return null;
    return m.get(Math.trunc(row), Math.trunc(col));
  });
  r.set("matrix.set", (c) => {
    const m = self(c);
    if (!m) return null;
    const row = extraNum(c, 0, "row");
    const col = extraNum(c, 1, "column");
    if (row === null || col === null) return null;
    m.set(Math.trunc(row), Math.trunc(col), extra(c, 2, "value"));
    return null;
  });
  r.set("matrix.row", (c) => {
    const m = self(c);
    if (!m) return null;
    const index = extraNum(c, 0, "row");
    if (index === null) return null;
    const row = m.rows[Math.trunc(index)];
    return row ? new PineArray(row.slice(), "float") : null;
  });
  r.set("matrix.col", (c) => {
    const m = self(c);
    if (!m) return null;
    const index = extraNum(c, 0, "column");
    if (index === null) return null;
    const col = Math.trunc(index);
    if (col < 0 || col >= m.cols) return null;
    return new PineArray(m.rows.map((row) => row[col] ?? null), "float");
  });
  r.set("matrix.rows", (c) => self(c)?.rowCount ?? null);
  r.set("matrix.columns", (c) => self(c)?.cols ?? null);
  r.set("matrix.elements_count", (c) => {
    const m = self(c);
    return m ? m.rowCount * m.cols : null;
  });
  r.set("matrix.reshape", (c) => {
    const m = self(c);
    if (!m) return null;
    let rows = extraInt(c, 0, "rows", 0);
    let cols = extraInt(c, 1, "columns", 0);
    const total = m.rowCount * m.cols;
    if (rows === 0 && cols === 0) return null;
    if (rows === 0) rows = cols === 0 ? 0 : Math.ceil(total / cols);
    else if (cols === 0) cols = Math.ceil(total / rows);
    if (rows * cols < total) return null;
    const flat = m.flat();
    const out = new PineMatrix(rows, cols, null);
    for (let i = 0; i < total; i++) out.set(Math.floor(i / cols), i % cols, flat[i] ?? null);
    return out;
  });
  r.set("matrix.submatrix", (c) => {
    const m = self(c);
    if (!m) return null;
    const fromRow = extraInt(c, 0, "from_row", 0);
    const toRow = extraInt(c, 1, "to_row", m.rowCount - 1);
    const fromCol = extraInt(c, 2, "from_column", 0);
    const toCol = extraInt(c, 3, "to_column", m.cols - 1);
    const out = new PineMatrix(0, 0);
    for (let r2 = fromRow; r2 <= toRow; r2++) {
      const row = [];
      for (let col = fromCol; col <= toCol; col++) row.push(m.get(r2, col));
      if (row.length > 0) out.rows.push(row);
    }
    out.cols = out.rows[0]?.length ?? 0;
    return out;
  });
  r.set("matrix.add_row", (c) => {
    const m = self(c);
    if (!m) return null;
    const row = extra(c, 0, "row");
    const index = extraNum(c, 1, "row_index");
    const values = row instanceof PineArray ? arrayToValues(row) : Array.from({ length: m.cols }, () => row ?? null);
    while (values.length < m.cols) values.push(null);
    const at = index === null ? m.rowCount : Math.max(0, Math.min(m.rowCount, Math.trunc(index)));
    m.rows.splice(at, 0, values.slice(0, m.cols));
    return null;
  });
  r.set("matrix.add_col", (c) => {
    const m = self(c);
    if (!m) return null;
    const column = extra(c, 0, "column");
    const index = extraNum(c, 1, "column_index");
    const values = column instanceof PineArray ? arrayToValues(column) : Array.from({ length: m.rowCount }, () => column ?? null);
    const at = index === null ? m.cols : Math.max(0, Math.min(m.cols, Math.trunc(index)));
    m.rows.forEach((row, i) => row.splice(at, 0, values[i] ?? null));
    m.cols += 1;
    return null;
  });
  r.set("matrix.remove_row", (c) => {
    const m = self(c);
    if (!m) return null;
    const index = extraNum(c, 0, "row");
    if (index === null) return null;
    const i = Math.trunc(index);
    if (i < 0 || i >= m.rowCount) return null;
    m.rows.splice(i, 1);
    return null;
  });
  r.set("matrix.remove_col", (c) => {
    const m = self(c);
    if (!m) return null;
    const index = extraNum(c, 0, "column");
    if (index === null) return null;
    const i = Math.trunc(index);
    if (i < 0 || i >= m.cols) return null;
    m.rows.forEach((row) => row.splice(i, 1));
    m.cols -= 1;
    return null;
  });
  r.set("matrix.fill", (c) => {
    const m = self(c);
    if (!m) return null;
    const value = extra(c, 0, "value");
    const fromRow = Math.max(0, extraInt(c, 1, "from_row", 0));
    const toRowRaw = extraInt(c, 2, "to_row", m.rowCount - 1);
    const toRow = toRowRaw < 0 ? m.rowCount - 1 : Math.min(m.rowCount - 1, toRowRaw);
    const fromCol = Math.max(0, extraInt(c, 3, "from_column", 0));
    const toColRaw = extraInt(c, 4, "to_column", m.cols - 1);
    const toCol = toColRaw < 0 ? m.cols - 1 : Math.min(m.cols - 1, toColRaw);
    for (let row = fromRow; row <= toRow; row++) {
      for (let col = fromCol; col <= toCol; col++) m.set(row, col, value);
    }
    return null;
  });
  r.set("matrix.reverse", (c) => {
    const m = self(c);
    if (!m) return null;
    m.rows.reverse();
    m.rows.forEach((row) => row.reverse());
    return null;
  });
  r.set("matrix.swap_rows", (c) => {
    const m = self(c);
    if (!m) return null;
    const a = extraNum(c, 0, "row1");
    const b = extraNum(c, 1, "row2");
    if (a === null || b === null) return null;
    const i = Math.trunc(a);
    const j = Math.trunc(b);
    const rowI = m.rows[i];
    const rowJ = m.rows[j];
    if (!rowI || !rowJ) return null;
    m.rows[i] = rowJ;
    m.rows[j] = rowI;
    return null;
  });
  r.set("matrix.swap_columns", (c) => {
    const m = self(c);
    if (!m) return null;
    const a = extraNum(c, 0, "column1");
    const b = extraNum(c, 1, "column2");
    if (a === null || b === null) return null;
    const i = Math.trunc(a);
    const j = Math.trunc(b);
    if (i < 0 || i >= m.cols || j < 0 || j >= m.cols) return null;
    for (const row of m.rows) {
      const tmp = row[i] ?? null;
      row[i] = row[j] ?? null;
      row[j] = tmp;
    }
    return null;
  });
  r.set("matrix.concat", (c) => {
    const a = self(c);
    const b = extra(c, 0, "id2");
    if (!a || !(b instanceof PineMatrix) || a.cols !== b.cols) return null;
    const out = a.clone();
    out.rows.push(...b.rows.map((row) => row.slice()));
    return out;
  });
  r.set("matrix.sort", (c) => {
    const m = self(c);
    if (!m) return null;
    const first = extra(c, 0);
    const shorthand = first === "ascending" || first === "descending" || first === "asc" || first === "desc";
    const col = shorthand ? 0 : extraInt(c, 0, "column", 0);
    const order = shorthand ? first : extra(c, 1, "order");
    const ascending = order === null || order === void 0 ? true : order !== "descending" && toBool(order) !== false;
    const sorted = m.rows.slice().sort((x, y) => {
      const a = toNum(x[col] ?? null);
      const b = toNum(y[col] ?? null);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return ascending ? a - b : b - a;
    });
    m.rows = sorted;
    return null;
  });
  const stat = (fn) => (c) => {
    const m = self(c);
    if (!m) return null;
    const values = m.numbers();
    if (values.length === 0) return null;
    return round(fn(values));
  };
  r.set("matrix.avg", stat((v) => v.reduce((a, b) => a + b, 0) / v.length));
  r.set("matrix.sum", stat((v) => v.reduce((a, b) => a + b, 0)));
  r.set("matrix.max", stat((v) => Math.max(...v)));
  r.set("matrix.min", stat((v) => Math.min(...v)));
  r.set("matrix.median", stat(median));
  r.set("matrix.mode", stat(mode));
  r.set("matrix.mult", (c) => {
    const a = self(c);
    if (!a) return null;
    const other = extra(c, 0, "id2");
    const scalar = toNum(other);
    if (other !== null && !(other instanceof PineMatrix) && !(other instanceof PineArray) && scalar !== null) {
      return fromNumbers(toNumbers(a).map((row) => row.map((v) => v * scalar)));
    }
    if (other instanceof PineArray) {
      const vec = other.items.map((v) => toNum(v) ?? NaN);
      if (vec.length !== a.cols) return null;
      const out = new PineArray(
        a.rows.map((row) => round(row.reduce((acc, v, i) => acc + (toNum(v) ?? 0) * vec[i], 0))),
        "float"
      );
      return out;
    }
    if (!(other instanceof PineMatrix)) return null;
    const product = multiply(toNumbers(a), toNumbers(other));
    return product ? fromNumbers(product) : null;
  });
  r.set("matrix.pow", (c) => {
    const m = self(c);
    if (!m) return null;
    const power = extraNum(c, 0, "power");
    if (power === null) return null;
    const out = matrixPower(toNumbers(m), power);
    return out ? fromNumbers(out) : null;
  });
  r.set("matrix.kron", (c) => {
    const a = self(c);
    const b = extra(c, 0, "id2");
    if (!a || !(b instanceof PineMatrix)) return null;
    return fromNumbers(kron(toNumbers(a), toNumbers(b)));
  });
  r.set("matrix.diff", (c) => {
    const m = self(c);
    if (!m) return null;
    const nums = toNumbers(m);
    const out = nums.map((row) => row.slice(1).map((v, i) => v - row[i]));
    return fromNumbers(out.filter((row) => row.length === (out[0]?.length ?? 0)));
  });
  r.set("matrix.det", (c) => {
    const m = self(c);
    if (!m) return null;
    const d = determinant(toNumbers(m));
    return Number.isFinite(d) ? round(d) : null;
  });
  r.set("matrix.inv", (c) => {
    const m = self(c);
    if (!m) return null;
    const inv = inverse(toNumbers(m));
    return inv ? fromNumbers(inv.map((row) => row.map(round))) : null;
  });
  r.set("matrix.pinv", (c) => {
    const m = self(c);
    if (!m) return null;
    const p = pseudoInverse(toNumbers(m));
    return p.length > 0 ? fromNumbers(p.map((row) => row.map(round))) : null;
  });
  r.set("matrix.rank", (c) => {
    const m = self(c);
    return m ? rank(toNumbers(m)) : null;
  });
  r.set("matrix.trace", (c) => {
    const m = self(c);
    return m ? round(trace(toNumbers(m))) : null;
  });
  r.set("matrix.transpose", (c) => {
    const m = self(c);
    return m ? fromNumbers(transpose(toNumbers(m))) : null;
  });
  r.set("matrix.eigenvalues", (c) => {
    const m = self(c);
    if (!m) return null;
    return new PineArray(
      eigenvalues(toNumbers(m)).map((v) => round(v)),
      "float"
    );
  });
  r.set("matrix.eigenvectors", (c) => {
    const m = self(c);
    if (!m) return null;
    return fromNumbers(eigenvectors(toNumbers(m)).map((row) => row.map(round)));
  });
  const predicate = (fn) => (c) => {
    const m = self(c);
    if (!m) return null;
    return fn(m, toNumbers(m));
  };
  const isSquare = (m) => m.rowCount === m.cols;
  r.set(
    "matrix.is_square",
    predicate((m) => isSquare(m))
  );
  r.set(
    "matrix.is_zero",
    predicate((m) => m.numbers().every((v) => Math.abs(v) < 1e-12))
  );
  r.set(
    "matrix.is_identity",
    predicate(
      (m) => isSquare(m) && m.rows.every((row, i) => row.every((v, j) => Math.abs((toNum(v) ?? NaN) - (i === j ? 1 : 0)) < 1e-12))
    )
  );
  r.set(
    "matrix.is_diagonal",
    predicate((m) => isSquare(m) && m.rows.every((row, i) => row.every((v, j) => i === j || Math.abs(toNum(v) ?? NaN) < 1e-12)))
  );
  r.set(
    "matrix.is_antidiagonal",
    predicate(
      (m) => isSquare(m) && m.rows.every((row, i) => row.every((v, j) => j === m.cols - 1 - i || Math.abs(toNum(v) ?? NaN) < 1e-12))
    )
  );
  r.set(
    "matrix.is_symmetric",
    predicate((_m, nums) => isSymmetric(nums))
  );
  r.set(
    "matrix.is_antisymmetric",
    predicate((m, nums) => isSquare(m) && nums.every((row, i) => row.every((v, j) => Math.abs(v + nums[j][i]) < 1e-12)))
  );
  r.set(
    "matrix.is_binary",
    predicate((m) => m.numbers().every((v) => Math.abs(v) < 1e-12 || Math.abs(v - 1) < 1e-12))
  );
  r.set(
    "matrix.is_stochastic",
    predicate((m, nums) => {
      if (nums.length === 0) return false;
      const rowSums = nums.map((row) => row.reduce((a, b) => a + b, 0));
      const colSums = (nums[0] ?? []).map((_, j) => nums.reduce((acc, row) => acc + row[j], 0));
      const one = (x) => Math.abs(x - 1) < 1e-9;
      return rowSums.every(one) || colSums.every(one);
    })
  );
  r.set(
    "matrix.is_triangular",
    predicate((m, nums) => {
      if (!isSquare(m)) return false;
      const upper = nums.every((row, i) => row.every((v, j) => j >= i || Math.abs(v) < 1e-12));
      const lower = nums.every((row, i) => row.every((v, j) => j <= i || Math.abs(v) < 1e-12));
      return upper || lower;
    })
  );
}

// src/runtime/builtins/map.ts
function self2(c) {
  const v = c.receiver !== void 0 ? c.receiver : c.arg(0, "id");
  return v instanceof PineMap ? v : null;
}
function base2(c) {
  return c.receiver !== void 0 ? 0 : 1;
}
function extra2(c, k, name) {
  return c.arg(base2(c) + k, name);
}
function registerMap(r) {
  r.set("map.new", (c) => {
    const keyType = extra2(c, 0, "key_type");
    const valueType = extra2(c, 1, "value_type");
    return new PineMap(typeof keyType === "string" ? keyType : "string", typeof valueType === "string" ? valueType : "float");
  });
  r.set("map.put", (c) => {
    const m = self2(c);
    if (!m) return null;
    const key = extra2(c, 0, "key");
    if (isNa(key)) return null;
    m.put(key, extra2(c, 1, "value"));
    return null;
  });
  r.set("map.put_all", (c) => {
    const a = self2(c);
    const b = extra2(c, 0, "id2");
    if (!a || !(b instanceof PineMap)) return null;
    for (const { key, value } of b.entries.values()) a.put(key, value);
    return null;
  });
  r.set("map.get", (c) => {
    const m = self2(c);
    if (!m) return null;
    return m.get(extra2(c, 0, "key"));
  });
  r.set("map.contains", (c) => {
    const m = self2(c);
    if (!m) return null;
    return m.contains(extra2(c, 0, "key"));
  });
  r.set("map.remove", (c) => {
    const m = self2(c);
    if (!m) return null;
    const key = extra2(c, 0, "key");
    const existed = m.contains(key);
    m.remove(key);
    return existed ? null : null;
  });
  r.set("map.clear", (c) => {
    const m = self2(c);
    m?.entries.clear();
    return null;
  });
  r.set("map.size", (c) => self2(c)?.size ?? null);
  r.set("map.keys", (c) => self2(c)?.keysArray() ?? null);
  r.set("map.values", (c) => self2(c)?.valuesArray() ?? null);
  r.set("map.copy", (c) => self2(c)?.clone() ?? null);
}

// src/runtime/builtins/drawing.ts
function store(c) {
  return c.rt.drawings;
}
function handle(kind, id) {
  return { __pine: kind, id };
}
function idOf(c, index, name) {
  const v = c.arg(index, name);
  if (v && typeof v === "object" && "__pine" in v) {
    const id = v.id;
    if (typeof id === "string") return id;
  }
  return "";
}
function mapFont(v) {
  return v === "monospace" || v === "family_monospace" ? "monospace" : "default";
}
function css(v) {
  if (v instanceof PineColor) return v.css;
  if (typeof v === "string") return v;
  return null;
}
function numOrNa(v) {
  return toNum(v) ?? NaN;
}
function styleOf2(v, fallback = "solid") {
  if (v === "dashed" || v === "dotted" || v === "solid") return v;
  return fallback;
}
function arrowStyle(v) {
  switch (v) {
    case "arrow_left":
      return { style: "solid", arrowLeft: true, arrowRight: false };
    case "arrow_right":
      return { style: "solid", arrowLeft: false, arrowRight: true };
    case "arrow_both":
      return { style: "solid", arrowLeft: true, arrowRight: true };
    default:
      return { style: styleOf2(v), arrowLeft: false, arrowRight: false };
  }
}
function pointX(p) {
  return Number.isNaN(p.index) ? p.time : p.index;
}
function extendOf(v) {
  if (v === "left" || v === "right" || v === "both") return v;
  return "none";
}
function xlocOf(v) {
  return v === "bar_time" ? "bar_time" : "bar_index";
}
function pointOf(c, index, name) {
  const v = c.arg(index, name);
  if (v && typeof v === "object" && v.__pine === "point") return v;
  return null;
}
function registerDrawing(r) {
  const makePoint = (c, time, index, price) => {
    const obj = store(c).create({ kind: "point", time, index, price });
    return { __pine: "point", id: obj.id, time: obj.time, index: obj.index, price: obj.price };
  };
  r.set("chart.point.new", (c) => makePoint(c, numOrNa(c.arg(0, "time")), intArg(c, 1, "index", 0), numOrNa(c.arg(2, "price"))));
  r.set("chart.point.from_index", (c) => makePoint(c, NaN, intArg(c, 0, "index", 0), numOrNa(c.arg(1, "price"))));
  r.set("chart.point.from_time", (c) => makePoint(c, numOrNa(c.arg(0, "time")), NaN, numOrNa(c.arg(1, "price"))));
  r.set("chart.point.now", (c) => {
    const bar = c.rt.currentBar;
    return makePoint(c, bar?.time ?? NaN, c.rt.barIndex, toNum(c.arg(0, "price")) ?? numOrNa(c.rt.valueByName("close")));
  });
  r.set("chart.point.copy", (c) => {
    const p = pointOf(c, 0, "id");
    if (!p) return null;
    return makePoint(c, p.time, p.index, p.price);
  });
  r.set("point.copy", (c) => {
    const p = pointOf(c, 0, "id");
    if (!p) return null;
    return makePoint(c, p.time, p.index, p.price);
  });
  r.set("line.new", (c) => {
    const obj = store(c).create({
      kind: "line",
      xloc: xlocOf(c.arg(4, "xloc")),
      x1: numOrNa(c.arg(0, "x1")),
      y1: numOrNa(c.arg(1, "y1")),
      x2: numOrNa(c.arg(2, "x2")),
      y2: numOrNa(c.arg(3, "y2")),
      extend: extendOf(c.arg(5, "extend")),
      color: css(c.arg(6, "color")),
      width: intArg(c, 8, "width", 1),
      ...arrowStyle(c.arg(7, "style")),
      deleted: false
    });
    return handle("line", obj.id);
  });
  r.set("line.copy", (c) => {
    const src = store(c).get(idOf(c, 0, "id"));
    if (!src) return null;
    const obj = store(c).create({ ...src, kind: "line", deleted: false });
    return handle("line", obj.id);
  });
  r.set("line.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("line.all", (c) => new PineArray(store(c).ids("line").map((id) => handle("line", id)), "line"));
  const lineGetter = (field) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const value = obj[field];
    return value === null || value === void 0 ? null : value;
  };
  r.set("line.get_x1", lineGetter("x1"));
  r.set("line.get_x2", lineGetter("x2"));
  r.set("line.get_y1", lineGetter("y1"));
  r.set("line.get_y2", lineGetter("y2"));
  r.set("line.get_price", lineGetter("y1"));
  r.set("line.get_xloc", lineGetter("xloc"));
  const lineSetter = (field, coerce) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj[field] = coerce(c.arg(1, field));
    return null;
  };
  r.set("line.set_x1", lineSetter("x1", numOrNa));
  r.set("line.set_x2", lineSetter("x2", numOrNa));
  r.set("line.set_y1", lineSetter("y1", numOrNa));
  r.set("line.set_y2", lineSetter("y2", numOrNa));
  r.set("line.set_color", lineSetter("color", (v) => css(v)));
  r.set("line.set_style", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const arrow = arrowStyle(c.arg(1, "style"));
    obj.style = arrow.style;
    obj.arrowLeft = arrow.arrowLeft;
    obj.arrowRight = arrow.arrowRight;
    return null;
  });
  r.set("line.set_width", lineSetter("width", (v) => toNum(v) ?? 1));
  r.set("line.set_extend", lineSetter("extend", (v) => extendOf(v)));
  r.set("line.set_xloc", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj.x1 = numOrNa(c.arg(1, "x1"));
    obj.x2 = numOrNa(c.arg(2, "x2"));
    obj.xloc = xlocOf(c.arg(3, "xloc"));
    return null;
  });
  r.set("line.set_xy1", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj.x1 = numOrNa(c.arg(1, "x"));
    obj.y1 = numOrNa(c.arg(2, "y"));
    return null;
  });
  r.set("line.set_xy2", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj.x2 = numOrNa(c.arg(1, "x"));
    obj.y2 = numOrNa(c.arg(2, "y"));
    return null;
  });
  const pointSetter = (which) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const point = pointOf(c, 1, "point");
    if (point) {
      if (which === "first") {
        obj.x1 = pointX(point);
        obj.y1 = point.price;
      } else {
        obj.x2 = pointX(point);
        obj.y2 = point.price;
      }
      return null;
    }
    if (which === "first") {
      obj.x1 = numOrNa(c.arg(1, "x"));
      obj.y1 = numOrNa(c.arg(2, "y"));
    } else {
      obj.x2 = numOrNa(c.arg(1, "x"));
      obj.y2 = numOrNa(c.arg(2, "y"));
    }
    return null;
  };
  r.set("line.set_first_point", pointSetter("first"));
  r.set("line.set_second_point", pointSetter("second"));
  r.set("label.new", (c) => {
    const obj = store(c).create({
      kind: "label",
      xloc: xlocOf(c.arg(3, "xloc")),
      x: numOrNa(c.arg(0, "x")),
      y: numOrNa(c.arg(1, "y")),
      yloc: (() => {
        const v = c.arg(4, "yloc");
        return v === "abovebar" || v === "belowbar" ? v : "price";
      })(),
      text: strArg(c, 2, "text", ""),
      style: (() => {
        const v = c.arg(6, "style");
        return typeof v === "string" ? v : "label_down";
      })(),
      color: css(c.arg(5, "color")) ?? "#2196f3",
      textColor: css(c.arg(7, "textcolor")) ?? (c.rt.isV6 ? "#ffffff" : "#000000"),
      size: typeof c.arg(8, "size") === "string" ? c.arg(8, "size") : "normal",
      textAlign: typeof c.arg(9, "textalign") === "string" ? c.arg(9, "textalign") : "center",
      tooltip: c.arg(10, "tooltip") === null ? null : toStr(c.arg(10, "tooltip")),
      fontFamily: mapFont(c.arg(11, "text_font_family")),
      bold: false,
      italic: false,
      deleted: false
    });
    return handle("label", obj.id);
  });
  r.set("label.copy", (c) => {
    const src = store(c).get(idOf(c, 0, "id"));
    if (!src) return null;
    const obj = store(c).create({ ...src, kind: "label", deleted: false });
    return handle("label", obj.id);
  });
  r.set("label.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("label.all", (c) => new PineArray(store(c).ids("label").map((id) => handle("label", id)), "label"));
  const labelGetter = (field) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    return obj ? obj[field] ?? null : null;
  };
  r.set("label.get_text", labelGetter("text"));
  r.set("label.get_x", labelGetter("x"));
  r.set("label.get_y", labelGetter("y"));
  const labelSetter = (field, coerce) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj[field] = coerce(c.arg(1, field));
    return null;
  };
  r.set("label.set_text", labelSetter("text", (v) => toStr(v ?? "")));
  r.set("label.set_color", labelSetter("color", (v) => css(v)));
  r.set("label.set_textcolor", labelSetter("textColor", (v) => css(v)));
  r.set("label.set_style", labelSetter("style", (v) => typeof v === "string" ? v : "label_down"));
  r.set("label.set_size", labelSetter("size", (v) => typeof v === "string" ? v : "normal"));
  r.set("label.set_textalign", labelSetter("textAlign", (v) => typeof v === "string" ? v : "center"));
  r.set("label.set_text_font_family", labelSetter("fontFamily", (v) => mapFont(v)));
  r.set("label.set_tooltip", labelSetter("tooltip", (v) => v === null ? null : toStr(v)));
  r.set("label.set_x", labelSetter("x", numOrNa));
  r.set("label.set_y", labelSetter("y", numOrNa));
  r.set("label.set_xloc", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj["x"] = numOrNa(c.arg(1, "x"));
    obj["xloc"] = xlocOf(c.arg(2, "xloc"));
    return null;
  });
  r.set("label.set_yloc", labelSetter("yloc", (v) => v === "abovebar" || v === "belowbar" ? v : "price"));
  r.set("label.set_xy", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj["x"] = numOrNa(c.arg(1, "x"));
    obj["y"] = numOrNa(c.arg(2, "y"));
    return null;
  });
  r.set("label.set_point", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const p = pointOf(c, 1, "point");
    if (p) {
      obj["x"] = p.index;
      obj["y"] = p.price;
    }
    return null;
  });
  r.set("label.set_text_formatting", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const v = c.arg(1, "text_formatting");
    obj["bold"] = v === "bold";
    obj["italic"] = v === "italic";
    return null;
  });
  r.set("box.new", (c) => {
    const obj = store(c).create({
      kind: "box",
      xloc: xlocOf(c.arg(8, "xloc")),
      left: numOrNa(c.arg(0, "left")),
      top: numOrNa(c.arg(1, "top")),
      right: numOrNa(c.arg(2, "right")),
      bottom: numOrNa(c.arg(3, "bottom")),
      borderColor: css(c.arg(4, "border_color")),
      borderWidth: intArg(c, 5, "border_width", 1),
      borderStyle: styleOf2(c.arg(6, "border_style")),
      extend: extendOf(c.arg(7, "extend")),
      bgColor: css(c.arg(9, "bgcolor")),
      text: c.arg(10, "text") === null ? null : toStr(c.arg(10, "text")),
      textSize: typeof c.arg(11, "text_size") === "string" ? c.arg(11, "text_size") : "normal",
      textColor: css(c.arg(12, "text_color")),
      hAlign: typeof c.arg(13, "text_halign") === "string" ? c.arg(13, "text_halign") : "center",
      vAlign: typeof c.arg(14, "text_valign") === "string" ? c.arg(14, "text_valign") : "center",
      wrap: typeof c.arg(15, "text_wrap") === "string" ? c.arg(15, "text_wrap") !== "none" : true,
      fontFamily: mapFont(c.arg(16, "text_font_family")),
      bold: false,
      italic: false,
      deleted: false
    });
    return handle("box", obj.id);
  });
  r.set("box.copy", (c) => {
    const src = store(c).get(idOf(c, 0, "id"));
    if (!src) return null;
    const obj = store(c).create({ ...src, kind: "box", deleted: false });
    return handle("box", obj.id);
  });
  r.set("box.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("box.all", (c) => new PineArray(store(c).ids("box").map((id) => handle("box", id)), "box"));
  const boxGetter = (field) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    return obj ? obj[field] ?? null : null;
  };
  r.set("box.get_left", boxGetter("left"));
  r.set("box.get_right", boxGetter("right"));
  r.set("box.get_top", boxGetter("top"));
  r.set("box.get_bottom", boxGetter("bottom"));
  const boxSetter = (field, coerce) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj[field] = coerce(c.arg(1, field));
    return null;
  };
  r.set("box.set_left", boxSetter("left", numOrNa));
  r.set("box.set_right", boxSetter("right", numOrNa));
  r.set("box.set_top", boxSetter("top", numOrNa));
  r.set("box.set_bottom", boxSetter("bottom", numOrNa));
  r.set("box.set_bgcolor", boxSetter("bgColor", (v) => css(v)));
  r.set("box.set_border_color", boxSetter("borderColor", (v) => css(v)));
  r.set("box.set_border_width", boxSetter("borderWidth", (v) => toNum(v) ?? 1));
  r.set("box.set_border_style", boxSetter("borderStyle", (v) => styleOf2(v)));
  r.set("box.set_extend", boxSetter("extend", (v) => extendOf(v)));
  r.set("box.set_text", boxSetter("text", (v) => toStr(v ?? "")));
  r.set("box.set_text_color", boxSetter("textColor", (v) => css(v)));
  r.set("box.set_text_size", boxSetter("textSize", (v) => typeof v === "string" ? v : "normal"));
  r.set("box.set_text_halign", boxSetter("hAlign", (v) => typeof v === "string" ? v : "center"));
  r.set("box.set_text_valign", boxSetter("vAlign", (v) => typeof v === "string" ? v : "center"));
  r.set("box.set_text_wrap", boxSetter("wrap", (v) => v !== "none"));
  r.set("box.set_text_font_family", boxSetter("fontFamily", (v) => mapFont(v)));
  r.set("box.set_text_formatting", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const v = c.arg(1, "text_formatting");
    obj["bold"] = v === "bold";
    obj["italic"] = v === "italic";
    return null;
  });
  const boxCorner = (xField, yField) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj[xField] = numOrNa(c.arg(1, "x"));
    obj[yField] = numOrNa(c.arg(2, "y"));
    return null;
  };
  r.set("box.set_lefttop", boxCorner("left", "top"));
  r.set("box.set_rightbottom", boxCorner("right", "bottom"));
  r.set("box.set_top_left_point", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const p = pointOf(c, 1, "point");
    if (p) {
      obj["left"] = pointX(p);
      obj["top"] = p.price;
    }
    return null;
  });
  r.set("box.set_bottom_right_point", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const p = pointOf(c, 1, "point");
    if (p) {
      obj["right"] = pointX(p);
      obj["bottom"] = p.price;
    }
    return null;
  });
  r.set("box.set_xloc", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj["left"] = numOrNa(c.arg(1, "left"));
    obj["right"] = numOrNa(c.arg(2, "right"));
    obj["xloc"] = xlocOf(c.arg(3, "xloc"));
    return null;
  });
  r.set("table.new", (c) => {
    const position = typeof c.arg(0, "position") === "string" ? c.arg(0, "position") : "top_right";
    const columns = Math.max(1, intArg(c, 1, "columns", 1));
    const rows = Math.max(1, intArg(c, 2, "rows", 1));
    const obj = store(c).create({
      kind: "table",
      position,
      columns,
      rows,
      bgColor: css(c.arg(3, "bgcolor")),
      frameColor: css(c.arg(4, "frame_color")),
      frameWidth: intArg(c, 5, "frame_width", 0),
      borderColor: css(c.arg(6, "border_color")),
      borderWidth: intArg(c, 7, "border_width", 0),
      cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => null)),
      merges: [],
      deleted: false
    });
    return handle("table", obj.id);
  });
  r.set("table.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("table.clear", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj.cells = Array.from({ length: obj.rows }, () => Array.from({ length: obj.columns }, () => null));
    obj.merges = [];
    return null;
  });
  r.set("table.all", (c) => new PineArray(store(c).ids("table").map((id) => handle("table", id)), "table"));
  const ensureCell = (obj, col, row) => {
    if (row < 0 || row >= obj.rows || col < 0 || col >= obj.columns) return null;
    const existing = obj.cells[row]?.[col] ?? null;
    const cell = existing ?? {
      hAlign: "center",
      vAlign: "center",
      textSize: "normal",
      fontFamily: "default",
      bold: false,
      italic: false
    };
    obj.cells[row][col] = cell;
    return cell;
  };
  r.set("table.cell", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const col = intArg(c, 1, "column", 0);
    const row = intArg(c, 2, "row", 0);
    const cell = ensureCell(obj, col, row);
    if (!cell) return null;
    const text = c.arg(3, "text");
    if (text !== null) cell.text = toStr(text);
    const width = toNum(c.arg(4, "width"));
    if (width !== null) cell.width = width;
    const height = toNum(c.arg(5, "height"));
    if (height !== null) cell.height = height;
    const textColor = css(c.arg(6, "text_color"));
    if (textColor) cell.textColor = textColor;
    if (typeof c.arg(7, "text_halign") === "string") cell.hAlign = c.arg(7, "text_halign");
    if (typeof c.arg(8, "text_valign") === "string") cell.vAlign = c.arg(8, "text_valign");
    const size = c.arg(9, "text_size");
    if (typeof size === "string") cell.textSize = size;
    else if (typeof size === "number") cell.textSize = size;
    const bg = css(c.arg(10, "bgcolor"));
    if (bg) cell.bgColor = bg;
    const tooltip = c.arg(11, "tooltip");
    if (tooltip !== null) cell.tooltip = toStr(tooltip);
    cell.fontFamily = mapFont(c.arg(12, "text_font_family"));
    const formatting = c.arg(13, "text_formatting");
    cell.bold = formatting === "bold";
    cell.italic = formatting === "italic";
    return null;
  });
  const cellField = (apply) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const cell = ensureCell(obj, intArg(c, 1, "column", 0), intArg(c, 2, "row", 0));
    if (!cell) return null;
    apply(cell, c.arg(3, "value"));
    return null;
  };
  r.set("table.cell_set_text", cellField((cell, v) => cell.text = toStr(v ?? "")));
  r.set("table.cell_set_text_color", cellField((cell, v) => {
    const color = css(v);
    if (color) cell.textColor = color;
  }));
  r.set("table.cell_set_bgcolor", cellField((cell, v) => {
    const color = css(v);
    if (color) cell.bgColor = color;
  }));
  r.set("table.cell_set_text_halign", cellField((cell, v) => cell.hAlign = typeof v === "string" ? v : "center"));
  r.set("table.cell_set_text_valign", cellField((cell, v) => cell.vAlign = typeof v === "string" ? v : "center"));
  r.set("table.cell_set_text_size", cellField((cell, v) => {
    if (typeof v === "string") cell.textSize = v;
    else if (typeof v === "number") cell.textSize = v;
  }));
  r.set("table.cell_set_text_font_family", cellField((cell, v) => cell.fontFamily = mapFont(v)));
  r.set("table.cell_set_width", cellField((cell, v) => {
    const n2 = toNum(v);
    if (n2 !== null) cell.width = n2;
  }));
  r.set("table.cell_set_height", cellField((cell, v) => {
    const n2 = toNum(v);
    if (n2 !== null) cell.height = n2;
  }));
  r.set("table.cell_set_tooltip", cellField((cell, v) => {
    if (v !== null) cell.tooltip = toStr(v);
  }));
  r.set("table.cell_set_text_formatting", cellField((cell, v) => {
    cell.bold = v === "bold";
    cell.italic = v === "italic";
  }));
  r.set("table.merge_cells", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    const startCol = intArg(c, 1, "start_column", 0);
    const startRow = intArg(c, 2, "start_row", 0);
    const endCol = intArg(c, 3, "end_column", startCol);
    const endRow = intArg(c, 4, "end_row", startRow);
    obj.merges.push({ startCol, startRow, endCol, endRow });
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (row === startRow && col === startCol) continue;
        const cell = obj.cells[row]?.[col];
        if (cell) cell.merged = true;
      }
    }
    return null;
  });
  const tableSetter = (field, coerce) => (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj[field] = coerce(c.arg(1, field));
    return null;
  };
  r.set("table.set_bgcolor", tableSetter("bgColor", (v) => css(v)));
  r.set("table.set_frame_color", tableSetter("frameColor", (v) => css(v)));
  r.set("table.set_frame_width", tableSetter("frameWidth", (v) => toNum(v) ?? 0));
  r.set("table.set_border_color", tableSetter("borderColor", (v) => css(v)));
  r.set("table.set_border_width", tableSetter("borderWidth", (v) => toNum(v) ?? 0));
  r.set("table.set_position", tableSetter("position", (v) => typeof v === "string" ? v : "top_right"));
  r.set("linefill.new", (c) => {
    const obj = store(c).create({
      kind: "linefill",
      line1: idOf(c, 0, "line1"),
      line2: idOf(c, 1, "line2"),
      color: css(c.arg(2, "color")),
      deleted: false
    });
    return handle("linefill", obj.id);
  });
  r.set("linefill.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("linefill.all", (c) => new PineArray(store(c).ids("linefill").map((id) => handle("linefill", id)), "linefill"));
  r.set("linefill.get_line1", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    return obj ? handle("line", obj.line1) : null;
  });
  r.set("linefill.get_line2", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    return obj ? handle("line", obj.line2) : null;
  });
  r.set("linefill.set_color", (c) => {
    const obj = store(c).get(idOf(c, 0, "id"));
    if (!obj) return null;
    obj.color = css(c.arg(1, "color"));
    return null;
  });
  r.set("polyline.new", (c) => {
    const pointsArg = c.arg(0, "points");
    const points = [];
    if (pointsArg instanceof PineArray) {
      for (const item of pointsArg.items) {
        if (item && typeof item === "object" && item.__pine === "point") {
          const p = item;
          points.push({ xloc: Number.isFinite(p.time) && !Number.isFinite(p.index) ? "bar_time" : "bar_index", x: Number.isFinite(p.index) ? p.index : p.time, price: p.price });
        }
      }
    }
    const obj = store(c).create({
      kind: "polyline",
      points,
      curved: boolArg(c, 1, "curved", false),
      closed: boolArg(c, 2, "closed", false),
      lineColor: css(c.arg(4, "line_color")),
      fillColor: css(c.arg(5, "fill_color")),
      lineStyle: styleOf2(c.arg(6, "line_style")),
      lineWidth: intArg(c, 7, "line_width", 1),
      deleted: false
    });
    return handle("polyline", obj.id);
  });
  r.set("polyline.delete", (c) => {
    store(c).delete(idOf(c, 0, "id"));
    return null;
  });
  r.set("polyline.all", (c) => new PineArray(store(c).ids("polyline").map((id) => handle("polyline", id)), "polyline"));
  const aliases = [
    ["line", "line.new"],
    ["label", "label.new"],
    ["box", "box.new"],
    ["table", "table.new"],
    ["linefill", "linefill.new"]
  ];
  for (const [alias, target] of aliases) {
    const fn = r.get(target);
    if (fn) r.set(alias, fn);
  }
}

// src/runtime/builtins/strategyMetrics.ts
function brokerOf(c) {
  return c.rt.broker;
}
function tradeArg(c) {
  return Math.trunc(numArg(c, 0, "trade_num") ?? -1);
}
function closed(c) {
  const broker = brokerOf(c);
  if (!broker) return null;
  const index = tradeArg(c);
  if (index < broker.trimmedTrades) return null;
  return broker.closedTrades[index - broker.trimmedTrades] ?? null;
}
function open(c) {
  const broker = brokerOf(c);
  if (!broker) return null;
  const list = broker.trades().filter((t) => t.open);
  return list[tradeArg(c)] ?? null;
}
function round22(x) {
  return Math.round(x * 100) / 100;
}
function registerStrategyMetrics(r) {
  const closedNum = (fn) => (c) => {
    const t = closed(c);
    if (!t) return null;
    const v = fn(t);
    return v === void 0 || !Number.isFinite(v) ? null : round22(v);
  };
  r.set("strategy.closedtrades.profit", closedNum((t) => t.pnl));
  r.set(
    "strategy.closedtrades.profit_percent",
    closedNum((t) => {
      const notional = (t.entry.price ?? 0) * t.qty;
      return notional > 0 && t.pnl !== void 0 ? t.pnl / notional * 100 : void 0;
    })
  );
  r.set("strategy.closedtrades.commission", closedNum((t) => t.commission));
  r.set("strategy.closedtrades.size", closedNum((t) => t.qty * (t.side === "long" ? 1 : -1)));
  r.set("strategy.closedtrades.entry_price", closedNum((t) => t.entry.price));
  r.set("strategy.closedtrades.entry_time", closedNum((t) => t.entry.time));
  r.set("strategy.closedtrades.exit_price", closedNum((t) => t.exit?.price));
  r.set("strategy.closedtrades.exit_time", closedNum((t) => t.exit?.time));
  r.set("strategy.closedtrades.entry_bar_index", closedNum((t) => t.entryBarIndex));
  r.set("strategy.closedtrades.exit_bar_index", closedNum((t) => t.exitBarIndex));
  r.set("strategy.closedtrades.max_runup", closedNum((t) => t.maxRunup));
  r.set("strategy.closedtrades.max_drawdown", closedNum((t) => t.maxDrawdown));
  r.set("strategy.closedtrades.max_runup_percent", closedNum((t) => t.maxRunupPercent));
  r.set("strategy.closedtrades.max_drawdown_percent", closedNum((t) => t.maxDrawdownPercent));
  const closedStr = (fn) => (c) => {
    const t = closed(c);
    if (!t) return null;
    const v = fn(t);
    return v === void 0 ? null : v;
  };
  r.set("strategy.closedtrades.entry_id", closedStr((t) => t.entry.id));
  r.set("strategy.closedtrades.exit_id", closedStr((t) => t.exit?.id));
  r.set("strategy.closedtrades.entry_comment", closedStr((t) => t.entry.comment));
  r.set("strategy.closedtrades.exit_comment", closedStr((t) => t.exit?.comment));
  const openNum = (fn) => (c) => {
    const t = open(c);
    if (!t) return null;
    const v = fn(t);
    return v === void 0 || !Number.isFinite(v) ? null : round22(v);
  };
  const unrealized = (t, lastPrice) => {
    const price = t.entry.price;
    return t.side === "long" ? (lastPrice - price) * t.qty : (price - lastPrice) * t.qty;
  };
  r.set("strategy.opentrades.size", openNum((t) => t.qty * (t.side === "long" ? 1 : -1)));
  r.set("strategy.opentrades.entry_price", openNum((t) => t.entry.price));
  r.set("strategy.opentrades.entry_time", openNum((t) => t.entry.time));
  r.set("strategy.opentrades.entry_bar_index", openNum((t) => t.entryBarIndex));
  r.set("strategy.opentrades.max_runup", openNum((t) => t.maxRunup));
  r.set("strategy.opentrades.max_drawdown", openNum((t) => t.maxDrawdown));
  r.set("strategy.opentrades.max_runup_percent", openNum((t) => t.maxRunupPercent));
  r.set("strategy.opentrades.max_drawdown_percent", openNum((t) => t.maxDrawdownPercent));
  r.set("strategy.opentrades.profit", (c) => {
    const t = open(c);
    if (!t) return null;
    return round22(unrealized(t, toNum(c.rt.valueByName("close")) ?? t.entry.price));
  });
  r.set("strategy.opentrades.profit_percent", (c) => {
    const t = open(c);
    if (!t) return null;
    const price = toNum(c.rt.valueByName("close")) ?? t.entry.price;
    const notional = t.entry.price * t.qty;
    return notional > 0 ? round22(unrealized(t, price) / notional * 100) : null;
  });
  r.set("strategy.opentrades.commission", openNum((t) => t.commission));
  r.set("strategy.opentrades.capital_held", (c) => {
    const t = open(c);
    if (!t) return null;
    return round22(t.entry.price * t.qty);
  });
  const openStr = (fn) => (c) => {
    const t = open(c);
    if (!t) return null;
    const v = fn(t);
    return v === void 0 ? null : v;
  };
  r.set("strategy.opentrades.entry_id", openStr((t) => t.entry.id));
  r.set("strategy.opentrades.entry_comment", openStr((t) => t.entry.comment));
  r.set("strategy.convert_to_account", (c) => {
    const v = toNum(c.arg(0, "value"));
    return v === null ? null : v;
  });
  r.set("strategy.convert_to_symbol", (c) => {
    const v = toNum(c.arg(0, "value"));
    return v === null ? null : v;
  });
  r.set("strategy.default_entry_qty", (c) => {
    const broker = brokerOf(c);
    const price = toNum(c.arg(0, "fill_price"));
    if (!broker || price === null || price <= 0) return null;
    const equity = broker.equity;
    switch (broker.opts.qtyType) {
      case "percent_of_equity":
        return Math.max(0, Math.floor(equity * (broker.opts.qtyValue / 100) / price));
      case "cash":
        return Math.max(0, Math.floor(broker.opts.qtyValue / price));
      default:
        return Math.abs(broker.opts.qtyValue);
    }
  });
  r.set("strategy.risk.max_cons_loss_days", (c) => {
    const days = toNum(c.arg(0, "num_days"));
    if (c.rt.broker && days !== null) c.rt.broker.maxConsLossDays = Math.max(1, Math.round(days));
    return days;
  });
  r.set("strategy.risk.max_drawdown", (c) => {
    const value = toNum(c.arg(0, "value"));
    const type = c.arg(1, "type");
    if (c.rt.broker && value !== null) {
      c.rt.broker.maxDrawdownLimit = value;
      c.rt.broker.maxDrawdownIsPercent = type === "percent_of_equity" || type === "percent";
    }
    return value;
  });
  r.set("strategy.risk.max_intraday_filled_orders", (c) => {
    const orders = toNum(c.arg(0, "num_orders"));
    if (c.rt.broker && orders !== null) c.rt.broker.maxIntradayFilledOrders = Math.max(1, Math.round(orders));
    return orders;
  });
  void toStr;
}

// src/runtime/constants.ts
var SIMPLE_NAMESPACES = {
  shape: ["arrowdown", "arrowup", "circle", "cross", "diamond", "flag", "labeldown", "labelup", "square", "triangledown", "triangleup", "xcross"],
  location: ["abovebar", "absolute", "belowbar", "bottom", "top"],
  size: ["auto", "huge", "large", "normal", "small", "tiny"],
  extend: ["both", "left", "none", "right"],
  font: ["family_default", "family_monospace"],
  format: ["inherit", "mintick", "percent", "price", "volume"],
  display: ["all", "data_window", "none", "pane", "pine_screener", "price_scale", "status_line"],
  order: ["ascending", "descending"],
  barmerge: ["gaps_off", "gaps_on", "lookahead_off", "lookahead_on"],
  scale: ["left", "none", "right"],
  position: ["bottom_center", "bottom_left", "bottom_right", "middle_center", "middle_left", "middle_right", "top_center", "top_left", "top_right"],
  settlement_as_close: ["inherit", "off", "on"],
  backadjustment: ["inherit", "off", "on"],
  adjustment: ["dividends", "none", "splits"],
  splits: ["denominator", "numerator"],
  dividends: ["future_amount", "future_ex_date", "future_pay_date", "gross", "net"],
  earnings: ["actual", "estimate", "future_eps", "future_period_end_time", "future_revenue", "future_time", "standardized"],
  xloc: ["bar_index", "bar_time"],
  yloc: ["abovebar", "belowbar", "price"]
};
var TEXT_CONSTANTS = {
  "text.align_left": "left",
  "text.align_center": "center",
  "text.align_right": "right",
  "text.align_top": "top",
  "text.align_bottom": "bottom",
  "text.format_bold": "bold",
  "text.format_italic": "italic",
  "text.format_none": "none",
  "text.wrap_auto": "auto",
  "text.wrap_none": "none"
};
var STYLE_CONSTANTS = {
  "plot.style_line": "line",
  "plot.style_linebr": "linebr",
  "plot.style_area": "area",
  "plot.style_areabr": "areabr",
  "plot.style_columns": "columns",
  "plot.style_histogram": "histogram",
  "plot.style_circles": "circles",
  "plot.style_cross": "cross",
  "plot.style_stepline": "stepline",
  "plot.style_stepline_diamond": "stepline_diamond",
  "plot.style_steplinebr": "steplinebr",
  "plot.linestyle_solid": "solid",
  "plot.linestyle_dashed": "dashed",
  "plot.linestyle_dotted": "dotted",
  "hline.style_solid": "solid",
  "hline.style_dashed": "dashed",
  "hline.style_dotted": "dotted",
  "line.style_solid": "solid",
  "line.style_dashed": "dashed",
  "line.style_dotted": "dotted",
  "line.style_arrow_left": "arrow_left",
  "line.style_arrow_right": "arrow_right",
  "line.style_arrow_both": "arrow_both"
};
var LABEL_STYLES = [
  "arrowdown",
  "arrowup",
  "circle",
  "cross",
  "diamond",
  "flag",
  "label_center",
  "label_down",
  "label_left",
  "label_lower_left",
  "label_lower_right",
  "label_right",
  "label_up",
  "label_upper_left",
  "label_upper_right",
  "none",
  "square",
  "text_outline",
  "triangledown",
  "triangleup",
  "xcross"
];
var CURRENCIES = [
  "AED",
  "ARS",
  "AUD",
  "BDT",
  "BHD",
  "BRL",
  "BTC",
  "CAD",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CZK",
  "DKK",
  "EGP",
  "ETH",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KES",
  "KRW",
  "KWD",
  "LKR",
  "MAD",
  "MXN",
  "MYR",
  "NGN",
  "NOK",
  "NONE",
  "NZD",
  "PEN",
  "PHP",
  "PKR",
  "PLN",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TND",
  "TRY",
  "TWD",
  "USD",
  "USDT",
  "VES",
  "VND",
  "ZAR"
];
var DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var ALERT_FREQS = ["freq_all", "freq_once_per_bar", "freq_once_per_bar_close"];
function buildTable() {
  const table = /* @__PURE__ */ new Map();
  for (const [ns, members] of Object.entries(SIMPLE_NAMESPACES)) {
    for (const member of members) table.set(`${ns}.${member}`, member);
  }
  for (const [key, value] of Object.entries(TEXT_CONSTANTS)) table.set(key, value);
  for (const [key, value] of Object.entries(STYLE_CONSTANTS)) table.set(key, value);
  for (const style of LABEL_STYLES) table.set(`label.style_${style}`, style);
  for (const code of CURRENCIES) table.set(`currency.${code}`, code);
  DAYS_OF_WEEK.forEach((name, i) => table.set(`dayofweek.${name}`, i + 1));
  for (const freq of ALERT_FREQS) table.set(`alert.${freq}`, freq);
  table.set("hline.style_solid", "solid");
  table.set("math.pi", Math.PI);
  table.set("math.e", Math.E);
  table.set("math.phi", 1.618033988749895);
  table.set("math.rphi", 0.618033988749895);
  return table;
}
var CONSTANTS = buildTable();
var V6_COLOR_OVERRIDES = {
  "color.red": "#f23645",
  "color.teal": "#089981",
  "color.yellow": "#fdd835"
};
function resolveColorV6(prop) {
  return V6_COLOR_OVERRIDES[`color.${prop}`];
}
function resolveConstant(ns, prop) {
  return CONSTANTS.get(`${ns}.${prop}`);
}

// src/runtime/members.ts
function resolveMember(rt, objectExpr, prop, line) {
  if (objectExpr.kind === "ident") {
    const ns = objectExpr.name;
    const value = resolveNamespaceMember(rt, ns, prop);
    if (value !== UNKNOWN) return value;
    const obj2 = rt.evalExpr(objectExpr);
    return propertyOf(obj2, prop, ns, line);
  }
  if (objectExpr.kind === "member" && objectExpr.object.kind === "ident" && objectExpr.object.name === "strategy") {
    if (objectExpr.prop === "commission") {
      return prop;
    }
    if (objectExpr.prop === "closedtrades" && prop === "first_index") {
      const broker = rt.broker;
      if (!broker) return null;
      return broker.closedTrades.length > 0 ? broker.trimmedTrades : null;
    }
    if (objectExpr.prop === "risk" && prop === "allow_entry_in") {
      return "allow_entry_in";
    }
    if (objectExpr.prop === "direction") return prop;
    if (objectExpr.prop === "oca") return prop;
    if (objectExpr.prop === "commission") return prop;
  }
  const obj = rt.evalExpr(objectExpr);
  return propertyOf(obj, prop, "(expression)", line);
}
var UNKNOWN = /* @__PURE__ */ Symbol("unknown-member");
function withMultiplier(timeframe) {
  return /^[A-Z]$/i.test(timeframe) ? `1${timeframe.toUpperCase()}` : timeframe;
}
function allDrawings(rt, ns) {
  const ids = rt.drawings.ids(ns);
  return new PineArray(ids.map((id) => ({ __pine: ns, id })), ns);
}
function propertyOf(obj, prop, ns, line) {
  if (obj && typeof obj === "object" && "__pine" in obj) {
    const record = obj;
    if (prop in record) return record[prop] ?? null;
  }
  throw new PineRuntimeError(`Unknown property "${ns}.${prop}"`, "UNDECLARED_VARIABLE", { line });
}
function resolveNamespaceMember(rt, ns, prop) {
  if (rt.isV6 && ns === "color") {
    const repainted = resolveColorV6(prop);
    if (repainted !== void 0) return repainted;
  }
  const value = resolveNamespaceMemberInner(rt, ns, prop);
  if (value !== UNKNOWN) return value;
  const constant = resolveConstant(ns, prop);
  return constant === void 0 ? UNKNOWN : constant;
}
function resolveNamespaceMemberInner(rt, ns, prop) {
  switch (ns) {
    case "math":
      switch (prop) {
        case "pi":
          return Math.PI;
        case "e":
          return Math.E;
        case "phi":
          return 1.618033988749895;
        case "rphi":
          return 0.618033988749895;
        default:
          return UNKNOWN;
      }
    case "color":
      if (prop in COLOR_NAMES) return new PineColor(COLOR_NAMES[prop]);
      if (prop === "none") return new PineColor("transparent");
      return UNKNOWN;
    case "syminfo": {
      const info = rt.market.symbolInfo ?? {};
      switch (prop) {
        case "ticker":
          return info.ticker ?? rt.market.symbol;
        case "tickerid":
          return info.ticker ?? rt.market.symbol;
        case "mintick":
          return info.mintick ?? 0.01;
        case "currency":
          return info.currency ?? "USD";
        case "timezone":
          return info.timezone ?? "UTC";
        case "session":
          return info.session ?? "24x7";
        case "type":
          return info.type ?? "crypto";
        case "root":
          return info.root ?? rt.market.symbol;
        case "pointvalue":
          return info.pointvalue ?? 1;
        case "prefix":
          return info.prefix ?? /^([^:]+):/.exec(String(info.tickerid ?? rt.market.symbol))?.[1] ?? "";
        case "description":
          return info.description ?? rt.market.symbol;
        case "current_contract":
        case "main_tickerid":
          return info[prop] ?? rt.market.symbol;
        default:
          return info[prop] ?? null;
      }
    }
    case "timeframe": {
      const tf = rt.market.timeframe;
      const minutes = tfMinutes(tf);
      switch (prop) {
        case "period":
          return rt.isV6 ? withMultiplier(tf) : tf;
        case "multiplier":
          return Number(/^(\d+)/.exec(tf)?.[1] ?? 1);
        case "isintraday":
          return minutes > 0 && minutes < 1440;
        case "isdaily":
          return tf === "D" || tf === "1D";
        case "isweekly":
          return tf === "W" || tf === "1W";
        case "ismonthly":
          return tf === "M" || tf === "1M";
        case "isminutes":
          return minutes >= 1 && minutes < 1440;
        case "isseconds":
          return /^S/i.test(tf) || /^\d+S$/i.test(tf);
        case "isdwm":
          return ["D", "W", "M", "1D", "1W", "1M"].includes(tf);
        case "in_seconds":
          return Math.round(minutes * 60);
        case "isticks":
          return false;
        case "main_period":
          return rt.isV6 ? withMultiplier(tf) : tf;
        case "change": {
          const frame = Math.round(minutes * 60 * 1e3);
          const barTime = toNum(rt.valueByName("time"));
          const prev = toNum(rt.valueByName("time")) !== null ? rt.bars[rt.barIndex - 1]?.time : void 0;
          if (barTime === null || prev === void 0 || frame <= 0) return false;
          return Math.floor(barTime / frame) !== Math.floor(prev / frame);
        }
        default:
          return UNKNOWN;
      }
    }
    case "barstate": {
      const i = rt.barIndex;
      const last = rt.bars.length - 1;
      switch (prop) {
        case "isfirst":
          return i === 0;
        case "islast":
          return i === last;
        case "isnew":
          return true;
        case "isconfirmed":
          return true;
        case "isrealtime":
          return false;
        case "ishistory":
          return true;
        case "islastconfirmedhistory":
          return i === last;
        default:
          return UNKNOWN;
      }
    }
    case "strategy": {
      const broker = rt.broker;
      if (!broker) return null;
      const state = broker.state();
      const closedList = broker.closedTrades;
      const netPnl = (t) => (t.pnl ?? 0) - (t.commission ?? 0);
      const avg = (values) => values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
      const round23 = (value) => value === null ? null : Math.round(value * 100) / 100;
      const pct = (value) => state.initialCapital > 0 ? Math.round(value / state.initialCapital * 1e4) / 100 : null;
      switch (prop) {
        case "position_size":
          return state.position;
        case "position_avg_price":
          return state.position === 0 ? null : state.avgPrice;
        case "position_entry_name":
          return broker.positionEntryName();
        case "equity":
          return state.equity;
        case "netprofit":
          return state.netPnl;
        case "netprofit_percent":
          return pct(state.netPnl);
        case "openprofit":
          return state.openPnl;
        case "openprofit_percent": {
          const notional = Math.abs(state.position) * state.avgPrice;
          if (state.position === 0 || notional <= 0) return 0;
          return Math.round(state.openPnl / notional * 1e4) / 100;
        }
        case "grossprofit":
          return state.grossProfit;
        case "grossprofit_percent":
          return pct(state.grossProfit);
        case "grossloss":
          return state.grossLoss;
        case "grossloss_percent":
          return pct(state.grossLoss);
        case "max_drawdown":
          return state.maxDrawdown;
        case "max_drawdown_percent":
          return pct(state.maxDrawdown);
        case "max_runup":
          return state.maxRunup;
        case "max_runup_percent":
          return pct(state.maxRunup);
        case "initial_capital":
          return state.initialCapital;
        case "account_currency":
          return rt.market.symbolInfo?.["currency"] ?? "USD";
        case "margin_liquidation_price":
          return broker.marginLiquidationPrice();
        case "wintrades":
          return state.wins;
        case "losstrades":
          return state.losses;
        case "eventrades":
          return state.even;
        case "closedtrades":
          return state.wins + state.losses + state.even;
        case "opentrades":
          return broker.trades().filter((t) => t.open).length;
        case "winrate":
          return state.wins + state.losses > 0 ? state.wins / (state.wins + state.losses) * 100 : 0;
        case "avg_trade":
          return avg(closedList.map(netPnl));
        case "avg_trade_percent":
          return avg(closedList.map((t) => netPnl(t) / state.initialCapital * 100));
        case "avg_winning_trade":
          return avg(closedList.filter((t) => netPnl(t) > 0).map(netPnl));
        case "avg_winning_trade_percent":
          return round23(avg(closedList.filter((t) => netPnl(t) > 0).map((t) => netPnl(t) / state.initialCapital * 100)));
        case "avg_losing_trade":
          return avg(closedList.filter((t) => netPnl(t) < 0).map(netPnl));
        case "avg_losing_trade_percent":
          return round23(avg(closedList.filter((t) => netPnl(t) < 0).map((t) => netPnl(t) / state.initialCapital * 100)));
        case "max_contracts_held_all":
          return broker.maxContractsAll;
        case "max_contracts_held_long":
          return broker.maxContractsLong;
        case "max_contracts_held_short":
          return broker.maxContractsShort;
        case "cash":
          return "cash";
        case "fixed":
          return "fixed";
        case "long":
          return 1;
        case "short":
          return -1;
        case "percent_of_equity":
          return "percent_of_equity";
        case "commission_percent":
          return "percent";
        case "commission_cash_per_order":
          return "cash_per_order";
        case "commission_cash_per_contract":
          return "cash_per_contract";
        default:
          return UNKNOWN;
      }
    }
    case "chart": {
      switch (prop) {
        case "left_visible_bar_time":
        case "right_visible_bar_time":
          rt.warn(prop, "chart visible-range builtins are not wired to a viewport in this engine build");
          return null;
        case "bg_color":
          return new PineColor("#131722");
        case "fg_color":
          return new PineColor("#d1d4dc");
        case "is_standard":
          return true;
        case "is_heikinashi":
        case "is_kagi":
        case "is_linebreak":
        case "is_pnf":
        case "is_range":
        case "is_renko":
          return false;
        default:
          return UNKNOWN;
      }
    }
    // Constant families below all read the one catalogue in `constants.ts`, so the
    // value a script sees and the value the audit checks can never drift apart. The
    // drawing/plotting layer is what turns these Pine tokens into host vocabulary.
    case "dayofweek":
    case "plot":
    case "hline":
    case "location":
    case "shape":
    case "size":
    case "format":
    case "alert":
    case "currency":
    case "order":
    case "display":
    case "extend":
    case "font":
    case "position":
    case "scale":
    case "text":
    case "xloc":
    case "yloc":
      return resolveConstant(ns, prop) ?? UNKNOWN;
    case "line":
    case "label":
    case "box":
    case "table":
    case "linefill":
    case "polyline": {
      if (prop === "all") return allDrawings(rt, ns);
      return resolveConstant(ns, prop) ?? UNKNOWN;
    }
    case "session": {
      const session = rt.market.symbolInfo?.["session"] ?? "24x7";
      const always = session === "24x7" || session === "24x7:1234567";
      switch (prop) {
        case "regular":
          return "regular";
        case "extended":
          return "extended";
        case "ismarket":
          return always ? true : true;
        case "ispremarket":
        case "ispostmarket":
          return false;
        case "isfirstbar":
        case "isfirstbar_regular":
          return rt.barIndex === 0;
        case "islastbar":
        case "islastbar_regular":
          return rt.barIndex === rt.bars.length - 1;
        default:
          return SESSION_CONSTANTS[prop] ?? UNKNOWN;
      }
    }
    case "runtime":
      return UNKNOWN;
    default: {
      const constant = resolveConstant(ns, prop);
      if (constant !== void 0) return constant;
      return UNKNOWN;
    }
  }
}
var SESSION_CONSTANTS = {
  regular: "regular",
  extended: "extended",
  ismarket: true,
  ispremarket: false,
  ispostmarket: false,
  isfirstbar: false,
  islastbar: false
};
function tfMinutes(tf) {
  const m = /^(\d*)\s*([SDWM]?)$/i.exec(tf.trim());
  if (!m) return 0;
  const n2 = Number(m[1] || 1);
  const unit = m[2].toUpperCase();
  switch (unit) {
    case "":
      return n2;
    case "S":
      return n2 / 60;
    case "D":
      return n2 * 1440;
    case "W":
      return n2 * 7 * 1440;
    case "M":
      return n2 * 30 * 1440;
    default:
      return 0;
  }
}
function barDurationMs(bars) {
  if (bars.length < 2) return 0;
  const a = bars[0];
  const b = bars[bars.length - 1];
  return Math.round((b.time - a.time) / (bars.length - 1));
}

// src/runtime/builtins/time.ts
function dateParts(c, argIndex2) {
  const raw = c.arg(argIndex2);
  const value = typeof raw === "number" ? raw : toNum(c.rt.valueByName("time"));
  if (value === null || !Number.isFinite(value)) return null;
  return new Date(value);
}
function registerTime(r) {
  r.set("hour", (c) => dateParts(c, 0)?.getUTCHours() ?? null);
  r.set("minute", (c) => dateParts(c, 0)?.getUTCMinutes() ?? null);
  r.set("second", (c) => dateParts(c, 0)?.getUTCSeconds() ?? null);
  r.set("dayofmonth", (c) => dateParts(c, 0)?.getUTCDate() ?? null);
  r.set("dayofweek", (c) => {
    const d = dateParts(c, 0);
    return d ? d.getUTCDay() + 1 : null;
  });
  r.set("month", (c) => dateParts(c, 0) ? dateParts(c, 0).getUTCMonth() + 1 : null);
  r.set("year", (c) => dateParts(c, 0)?.getUTCFullYear() ?? null);
  r.set("weekofyear", (c) => {
    const d = dateParts(c, 0);
    if (!d) return null;
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((d.getTime() - start) / (7 * 864e5)) + 1;
  });
  r.set("time_close", (c) => {
    const raw = c.arg(0);
    if (raw === null || c.args.length === 0) return c.rt.valueByName("time_close");
    const value = toNum(raw);
    if (value === null) return c.rt.valueByName("time_close");
    return value + c.rt.barDurationMs();
  });
  r.set("time_tradingday", (c) => toNum(c.rt.valueByName("time")));
  r.set("timeframe.in_seconds", (c) => {
    const tf = strArg(c, 0, "timeframe", String(c.rt.market.timeframe));
    const minutes = tfMinutes(tf);
    return minutes > 0 ? Math.round(minutes * 60) : null;
  });
  r.set("timeframe.from_seconds", (c) => {
    const seconds = toNum(c.arg(0, "seconds"));
    if (seconds === null || seconds <= 0) return null;
    const minutes = seconds / 60;
    if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}D`;
    if (minutes >= 60 && minutes % 60 === 0) return String(minutes);
    if (minutes >= 1) return String(Math.round(minutes));
    return `${Math.round(seconds)}S`;
  });
  r.set("timeframe.change", (c) => {
    const tf = strArg(c, 0, "timeframe", String(c.rt.market.timeframe));
    const frame = tfMinutes(tf) * 6e4;
    const bar = c.rt.bar;
    const prev = c.rt.bars[c.rt.barIndex - 1];
    if (!bar || !prev || frame <= 0) return false;
    return Math.floor(bar.time / frame) !== Math.floor(prev.time / frame);
  });
  r.set("syminfo.prefix", (c) => {
    const info = c.rt.market.symbolInfo ?? {};
    const arg = c.arg(0, "ticker");
    if (typeof arg === "string" && arg.length > 0) {
      const colon2 = arg.indexOf(":");
      return colon2 >= 0 ? arg.slice(0, colon2) : arg;
    }
    const explicit = info["prefix"];
    if (typeof explicit === "string" && explicit.length > 0) return explicit;
    const symbol = String(info["ticker"] ?? c.rt.market.symbol);
    const colon = symbol.indexOf(":");
    return colon >= 0 ? symbol.slice(0, colon) : symbol;
  });
  r.set("syminfo.ticker", (c) => {
    const symbol = c.rt.market.symbol;
    const colon = symbol.indexOf(":");
    return colon >= 0 ? symbol.slice(colon + 1) : symbol;
  });
  const tickerHandle = (c, symbol, timeframe) => ({
    __pine: "ticker",
    symbol: symbol.toUpperCase(),
    timeframe
  });
  r.set("ticker.new", (c) => {
    const prefix = strArg(c, 0, "prefix", "");
    const ticker = strArg(c, 1, "ticker", String(c.rt.market.symbol));
    const id = prefix.length > 0 ? `${prefix}:${ticker}` : ticker;
    return tickerHandle(c, id, String(c.rt.market.timeframe));
  });
  r.set("ticker.inherit", (c) => {
    const from = c.arg(0, "from_tickerid");
    const symbol = from?.symbol ?? String(c.rt.market.symbol);
    return tickerHandle(c, symbol, strArg(c, 1, "timeframe", String(c.rt.market.timeframe)));
  });
  r.set("ticker.modify", (c) => {
    const base3 = c.arg(0, "tickerid");
    const symbol = base3?.symbol ?? String(c.rt.market.symbol);
    const tf = strArg(c, 1, "timeframe", String(c.rt.market.timeframe));
    const session = c.arg(2, "session");
    return { __pine: "ticker", symbol, timeframe: tf, session };
  });
  for (const name of ["ticker.heikinashi", "ticker.kagi", "ticker.linebreak", "ticker.pointfigure", "ticker.renko", "ticker.standard"]) {
    r.set(name, (c) => {
      const base3 = c.arg(0, "symbol");
      const symbol = base3?.symbol ?? (typeof base3 === "string" ? base3 : String(c.rt.market.symbol));
      return tickerHandle(c, symbol, String(c.rt.market.timeframe));
    });
  }
  const logAt = (level) => (c) => {
    const message = strArg(c, 0, "message", "");
    c.rt.warn(`log.${level}`, message);
    return null;
  };
  r.set("log.info", logAt("info"));
  r.set("log.warning", logAt("warning"));
  r.set("log.error", logAt("error"));
  r.set("float", (c) => {
    const n2 = toNum(c.arg(0));
    return n2 === null ? null : n2;
  });
  r.set("int", (c) => {
    const n2 = toNum(c.arg(0));
    return n2 === null ? null : Math.trunc(n2);
  });
  r.set("bool", (c) => {
    const v = c.arg(0);
    if (v === null) return false;
    if (typeof v === "boolean") return v;
    const n2 = toNum(v);
    return n2 === null ? false : n2 !== 0;
  });
  r.set("string", (c) => toStr(c.arg(0) ?? null));
  r.set("color", (c) => {
    const v = c.arg(0);
    if (v instanceof PineColor) return v;
    if (typeof v === "string") return new PineColor(v);
    return null;
  });
}

// src/runtime/builtins/index.ts
var BUILTINS = /* @__PURE__ */ new Map();
registerTa(BUILTINS);
registerTaExtended(BUILTINS);
registerArrayExtended(BUILTINS);
registerStrExtended(BUILTINS);
registerMath(BUILTINS);
registerStr(BUILTINS);
registerArray(BUILTINS);
registerInput(BUILTINS);
registerDraw(BUILTINS);
registerRequest(BUILTINS);
registerStrategy(BUILTINS);
registerMisc(BUILTINS);
registerMatrix(BUILTINS);
registerMap(BUILTINS);
registerDrawing(BUILTINS);
registerStrategyMetrics(BUILTINS);
registerTime(BUILTINS);
function builtinNames() {
  return [...BUILTINS.keys()].sort();
}

// src/runtime/runtime.ts
var KNOWN_NAMESPACES = /* @__PURE__ */ new Set([
  "ta",
  "math",
  "str",
  "array",
  "input",
  "request",
  "strategy",
  "color",
  "chart",
  "label",
  "line",
  "box",
  "table",
  "runtime",
  "alert",
  "syminfo",
  "timeframe",
  "session",
  "barstate"
]);
function memberPath(expr) {
  if (expr.kind === "ident") return expr.name;
  if (expr.kind === "member") {
    const head = memberPath(expr.object);
    return head ? `${head}.${expr.prop}` : "";
  }
  return "";
}
function toMatrixRows(m) {
  const rows = m["rows"];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => row);
}
var BreakSignal = class {
};
var ContinueSignal = class {
};
var ReturnSignal = class {
  constructor(value) {
    this.value = value;
  }
  value;
};
function calleePathOf(callee) {
  const parts = [];
  let node = callee;
  while (node.kind === "member") {
    parts.unshift(node.prop);
    node = node.object;
  }
  if (node.kind !== "ident") return "";
  parts.unshift(node.name);
  return parts.join(".");
}
var Runtime = class _Runtime {
  script;
  bars;
  market;
  declaration;
  sink = new PlotSink();
  /** Drawing objects created by this run (`line`, `label`, `box`, `table`, …). */
  drawings = new DrawingStore();
  pendingAlerts = [];
  broker;
  warnings = [];
  barIndex = -1;
  frames = /* @__PURE__ */ new Map();
  scopePath = [];
  callStates = /* @__PURE__ */ new Map();
  exprHistory = /* @__PURE__ */ new Map();
  nodeIds = /* @__PURE__ */ new WeakMap();
  nextNodeId = 1;
  /** Per-library member tables, so a library's body sees its own names. */
  libraryFunctions = /* @__PURE__ */ new Map();
  libraryMethods = /* @__PURE__ */ new Map();
  /** `method`s a library declares `export`, callable by the importing script. */
  libraryExportedMethods = /* @__PURE__ */ new Map();
  libraryEnums = /* @__PURE__ */ new Map();
  libraryTypes = /* @__PURE__ */ new Map();
  /** Alias of the library whose function is currently executing, if any. */
  libraryStack = [];
  functions = /* @__PURE__ */ new Map();
  /** `type` declarations: UDT name → field list (in declaration order). */
  userTypes = /* @__PURE__ */ new Map();
  /** `enum` declarations: enum name → member map. */
  enums = /* @__PURE__ */ new Map();
  /** `method` declarations, keyed by method name (they share one namespace in Pine). */
  methods = /* @__PURE__ */ new Map();
  namespaces = /* @__PURE__ */ new Map();
  callDepth = 0;
  config;
  firstBarCache = /* @__PURE__ */ new Map();
  constructor(config) {
    this.config = config;
    this.script = config.script;
    this.bars = config.bars;
    this.market = config.market;
    this.declaration = config.declaration;
    this.broker = config.declaration.isStrategy ? new Broker(config.declaration.broker) : null;
    this.frames.set("", new Frame(""));
    this.collectFunctions();
    this.seedBuiltinSlots();
    this.hoistLegacyLocals();
  }
  /** Declared Pine version (1–6); a script without an annotation is v1. */
  get version() {
    return this.script.version ?? 1;
  }
  /**
   * Pine v1/v2 allowed a variable to reference itself or a later declaration
   * (`s = nz(s[1]) + close`); v3 removed both, because a name must be declared before it
   * is read. Pre-declaring every top-level assignment target reproduces the v1/v2 rule
   * without weakening v3+ (their scripts never rely on it, and a genuinely undeclared
   * name still errors).
   */
  hoistLegacyLocals() {
    if (this.version > 2) return;
    const frame = this.frames.get("");
    const declare = (stmt) => {
      if (stmt.kind !== "assign" || stmt.decl !== "none") return;
      for (const target of stmt.targets) {
        if (target.kind === "ident" && !frame.get(target.name)) frame.declare(target.name);
      }
    };
    for (const stmt of this.script.body) declare(stmt);
  }
  /**
   * v6 semantics. The differences that matter at runtime are documented in the official
   * migration guide: strict `bool` conditions, lazy `and`/`or`, fractional `const int`
   * division, dynamic `request.*()`, negative array indices and a live loop boundary.
   */
  get isV6() {
    return this.version >= 6;
  }
  /**
   * Evaluate a condition. Pine v6 forbids implicitly casting `int`/`float` to `bool`
   * (`if 1` is a compile error); v5 and older accept any value through truthiness.
   */
  cond(expr) {
    const value = this.evalExpr(expr);
    if (!this.isV6) return truthy(value);
    if (typeof value === "boolean") return value;
    if (value === null) return false;
    throw new PineRuntimeError(
      `Condition must be of type "bool", got "${typeof value}" (Pine v6 removed the implicit int/float to bool cast)`,
      "TYPE_ERROR",
      { line: expr.line }
    );
  }
  // ------------------------------------------------------------------ setup
  collectFunctions() {
    for (const stmt of this.script.body) {
      if (stmt.kind === "func") {
        if (stmt.method) this.methods.set(stmt.name, stmt);
        else this.functions.set(stmt.name, stmt);
      }
      if (stmt.kind === "typedef") this.userTypes.set(stmt.name, stmt.fields);
      if (stmt.kind === "enumdef") this.defineEnum(stmt.name, stmt.members);
    }
    for (const [alias, body] of this.config.libraries) {
      const exported = /* @__PURE__ */ new Map();
      const own = /* @__PURE__ */ new Map();
      const methods = /* @__PURE__ */ new Map();
      const enums = /* @__PURE__ */ new Map();
      const types = /* @__PURE__ */ new Map();
      for (const stmt of body) {
        if (stmt.kind === "func") {
          own.set(stmt.name, stmt);
          if (stmt.method) {
            methods.set(stmt.name, stmt);
            if (stmt.exported) this.libraryExportedMethods.set(stmt.name, stmt);
          }
          if (stmt.exported) exported.set(stmt.name, stmt);
        }
        if (stmt.kind === "typedef") {
          types.set(stmt.name, stmt.fields);
          this.userTypes.set(`${alias}.${stmt.name}`, stmt.fields);
        }
        if (stmt.kind === "enumdef") {
          enums.set(stmt.name, this.enumValues(stmt.members));
        }
      }
      this.namespaces.set(alias, exported);
      this.libraryFunctions.set(alias, own);
      if (methods.size > 0) this.libraryMethods.set(alias, methods);
      if (enums.size > 0) this.libraryEnums.set(alias, enums);
      if (types.size > 0) this.libraryTypes.set(alias, types);
    }
  }
  /** `enum Name` → a namespace whose members are strings (or the declared constants). */
  defineEnum(name, members) {
    this.enums.set(name, this.enumValues(members));
  }
  /** Evaluate an enum's members into name → value. */
  enumValues(members) {
    const values = /* @__PURE__ */ new Map();
    for (const member of members) {
      let value = member.name;
      const expr = member.value;
      if (expr) {
        if (expr.kind === "str" || expr.kind === "num" || expr.kind === "bool") value = expr.value;
        else {
          try {
            value = this.evalExpr(expr);
          } catch {
            value = member.name;
          }
        }
      }
      values.set(member.name, value);
    }
    return values;
  }
  /** Build a user-defined-type instance, filling fields positionally or by name. */
  constructUserType(name, fields, args) {
    const instance = { __pine: "udt", __type: name };
    fields.forEach((field, index) => {
      const named = args.find((a) => a.name === field.name);
      const positional = args[index];
      if (named) instance[field.name] = this.evalExpr(named.value);
      else if (positional && positional.name === void 0) instance[field.name] = this.evalExpr(positional.value);
      else instance[field.name] = field.def ? this.evalExpr(field.def) : null;
    });
    return instance;
  }
  seedBuiltinSlots() {
    const global = this.globalFrame();
    for (const name of ["open", "high", "low", "close", "volume", "time", "bar_index", "hl2", "hlc3", "ohlc4", "hlcc4", "last_bar_index", "last_bar_time", "hour", "minute", "second", "dayofmonth", "dayofweek", "month", "year", "weekofyear", "time_close"]) {
      global.declare(name, true);
    }
  }
  globalFrame() {
    return this.frames.get("");
  }
  /** Absolute scope path for a child segment of the current scope. */
  childPath(segment) {
    const base3 = this.scopePath.join("/");
    return base3 ? `${base3}/${segment}` : segment;
  }
  currentFrame() {
    const key = this.scopePath.join("/");
    let frame = this.frames.get(key);
    if (!frame) {
      frame = new Frame(key);
      this.frames.set(key, frame);
    }
    return frame;
  }
  // ---------------------------------------------------------------- execution
  run() {
    for (let i = 0; i < this.bars.length; i++) this.step(i);
    const globals = /* @__PURE__ */ new Map();
    for (const [name, slot] of this.globalFrame().slots) globals.set(name, slot.current);
    return { sink: this.sink, broker: this.broker, globals, barIndex: this.barIndex };
  }
  /** Execute one bar, returning the value of the last top-level expression. */
  step(index) {
    const bar = this.bars[index];
    if (!bar) return null;
    this.barIndex = index;
    this.seedBarSeries(bar, index);
    this.broker?.onBarOpen(bar, index);
    this.scopePath = [];
    let value = null;
    try {
      value = this.execBlock(this.script.body);
    } catch (err) {
      if (err instanceof ReturnSignal) {
        throw new PineRuntimeError("`return` outside of a function", "SCRIPT_ERROR", { bar: index });
      }
      if (err instanceof BreakSignal || err instanceof ContinueSignal) {
        throw new PineRuntimeError("`break`/`continue` outside of a loop", "SCRIPT_ERROR", { bar: index });
      }
      throw err;
    }
    this.broker?.onBarClose(bar, index);
    this.endBar();
    return value;
  }
  endBar() {
    for (const [path, frame] of this.frames) {
      for (const slot of frame.slots.values()) slot.commit();
      if (path !== "") {
        for (const [name, slot] of [...frame.slots]) {
          if (!slot.persistent) frame.slots.delete(name);
        }
        if (frame.slots.size === 0) this.frames.delete(path);
      }
    }
  }
  seedBarSeries(bar, index) {
    const g = this.globalFrame();
    const set = (name, value) => {
      const slot = g.get(name);
      if (slot) slot.current = value;
    };
    set("open", bar.open);
    set("high", bar.high);
    set("low", bar.low);
    set("close", bar.close);
    set("volume", bar.volume ?? null);
    set("time", bar.time);
    set("bar_index", index);
    set("hl2", (bar.high + bar.low) / 2);
    set("hlc3", (bar.high + bar.low + bar.close) / 3);
    set("ohlc4", (bar.open + bar.high + bar.low + bar.close) / 4);
    set("hlcc4", (bar.high + bar.low + bar.close + bar.close) / 4);
    set("last_bar_index", this.bars.length - 1);
    const last = this.bars[this.bars.length - 1];
    set("last_bar_time", last ? last.time : null);
    const d = new Date(bar.time);
    set("hour", d.getUTCHours());
    set("minute", d.getUTCMinutes());
    set("second", d.getUTCSeconds());
    set("dayofmonth", d.getUTCDate());
    set("dayofweek", d.getUTCDay() + 1);
    set("month", d.getUTCMonth() + 1);
    set("year", d.getUTCFullYear());
    set("weekofyear", isoWeek(d));
    const next = this.bars[index + 1];
    const prev = index > 0 ? this.bars[index - 1] : void 0;
    const stepMs = next ? next.time - bar.time : prev ? bar.time - prev.time : 0;
    set("time_close", bar.time + stepMs);
  }
  // --------------------------------------------------------------- statements
  execBlock(stmts) {
    let last = null;
    for (const stmt of stmts) last = this.execStmt(stmt);
    return last;
  }
  execScoped(stmts, tag) {
    this.scopePath.push(tag);
    try {
      return this.execBlock(stmts);
    } finally {
      this.scopePath.pop();
    }
  }
  execStmt(stmt) {
    switch (stmt.kind) {
      case "empty":
      // Declarations are collected up front; executing them is a no-op.
      case "typedef":
      case "enumdef":
        return null;
      case "expr":
        return this.evalExpr(stmt.expr);
      case "assign":
        return this.execAssign(stmt);
      case "if": {
        const cond = this.cond(stmt.cond);
        if (cond) return this.execScoped(stmt.then, `if@${stmt.line}:${stmt.col}`);
        if (stmt.else) return this.execScoped(stmt.else, `else@${stmt.line}:${stmt.col}`);
        return null;
      }
      case "switch":
        return this.execSwitch(stmt);
      case "for":
        return this.execFor(stmt);
      case "forin":
        return this.execForIn(stmt);
      case "while":
        return this.execWhile(stmt);
      case "break":
        throw new BreakSignal();
      case "continue":
        throw new ContinueSignal();
      case "func":
        this.functions.set(stmt.name, stmt);
        return null;
      case "return":
        throw new ReturnSignal(stmt.expr ? this.evalExpr(stmt.expr) : null);
      case "import":
        return null;
      default:
        throw new PineRuntimeError(`Unsupported statement "${stmt.kind}"`, "UNSUPPORTED_FEATURE", {
          line: stmt.line
        });
    }
  }
  execSwitch(stmt) {
    const subject = stmt.subject ? this.evalExpr(stmt.subject) : null;
    for (const c of stmt.cases) {
      const matched = this.switchMatches(c, subject, stmt.subject !== null);
      if (matched) return this.execCase(c, stmt);
    }
    return null;
  }
  switchMatches(c, subject, hasSubject) {
    if (c.test === null) return true;
    if (!hasSubject) return truthy(this.evalExpr(c.test));
    const test = this.evalExpr(c.test);
    if (subject === null || test === null) return false;
    return subject === test;
  }
  execCase(c, owner) {
    if (c.body.length > 0) return this.execScoped(c.body, `case@${owner.line}:${owner.col}`);
    if (c.exprBody) return this.evalExpr(c.exprBody);
    return null;
  }
  execFor(stmt) {
    const from = toNum(this.evalExpr(stmt.from));
    const to = toNum(this.evalExpr(stmt.to));
    const step = stmt.step ? toNum(this.evalExpr(stmt.step)) : 1;
    if (from === null || to === null || step === null || step === 0) return null;
    const start = Math.trunc(from);
    const end = Math.trunc(to);
    const inc = Math.trunc(step);
    let last = null;
    const dir = inc > 0 ? 1 : -1;
    for (let i = start; ; i += inc) {
      const boundary = this.isV6 ? Math.trunc(toNum(this.evalExpr(stmt.to)) ?? end) : end;
      if (dir > 0 ? i > boundary : i < boundary) break;
      this.scopePath.push(`for@${stmt.line}:${stmt.col}#${i}`);
      try {
        const frame = this.currentFrame();
        const slot = frame.get(stmt.varName) ?? frame.declare(stmt.varName);
        slot.current = i;
        last = this.execBlock(stmt.body);
      } catch (err) {
        if (err instanceof BreakSignal) {
          this.scopePath.pop();
          break;
        }
        if (err instanceof ContinueSignal) {
          this.scopePath.pop();
          continue;
        }
        this.scopePath.pop();
        throw err;
      }
      this.scopePath.pop();
    }
    return last;
  }
  /**
   * `while <cond>` loop. Pine caps loop execution (there is no `for`-style bound to
   * enforce), so the engine raises after `LOOP_LIMIT` iterations instead of hanging.
   */
  execWhile(stmt) {
    const LOOP_LIMIT = 1e5;
    let last = null;
    for (let n2 = 0; ; n2++) {
      if (n2 >= LOOP_LIMIT) {
        throw new PineRuntimeError(`\`while\` loop exceeded ${LOOP_LIMIT} iterations`, "SCRIPT_ERROR", {
          line: stmt.line
        });
      }
      if (!this.cond(stmt.cond)) break;
      this.scopePath.push(`while@${stmt.line}:${stmt.col}#${n2}`);
      try {
        last = this.execBlock(stmt.body);
      } catch (err) {
        if (err instanceof BreakSignal) {
          this.scopePath.pop();
          break;
        }
        if (err instanceof ContinueSignal) {
          this.scopePath.pop();
          continue;
        }
        this.scopePath.pop();
        throw err;
      }
      this.scopePath.pop();
    }
    return last;
  }
  execForIn(stmt) {
    const iterable = this.evalExpr(stmt.iterable);
    let items = [];
    let keys = null;
    if (iterable instanceof PineTuple) items = iterable.items;
    else if (iterable && typeof iterable === "object" && iterable.__pine === "array") {
      items = iterable.items.slice();
    } else if (iterable && typeof iterable === "object" && iterable.__pine === "matrix") {
      items = toMatrixRows(iterable);
    } else if (iterable && typeof iterable === "object" && iterable.__pine === "map") {
      const m = iterable;
      keys = [...m.entries.values()].map((e) => e.key);
      items = [...m.entries.values()].map((e) => e.value);
    }
    let last = null;
    for (let i = 0; i < items.length; i++) {
      this.scopePath.push(`forin@${stmt.line}:${stmt.col}#${i}`);
      try {
        const frame = this.currentFrame();
        const slot = frame.get(stmt.varName) ?? frame.declare(stmt.varName);
        slot.current = items[i] ?? null;
        if (stmt.varName2) {
          const slot2 = frame.get(stmt.varName2) ?? frame.declare(stmt.varName2);
          if (keys) {
            slot.current = keys[i] ?? null;
            slot2.current = items[i] ?? null;
          } else {
            slot.current = i;
            slot2.current = items[i] ?? null;
          }
        }
        last = this.execBlock(stmt.body);
      } catch (err) {
        if (err instanceof BreakSignal) {
          this.scopePath.pop();
          break;
        }
        if (err instanceof ContinueSignal) {
          this.scopePath.pop();
          continue;
        }
        this.scopePath.pop();
        throw err;
      }
      this.scopePath.pop();
    }
    return last;
  }
  execAssign(stmt) {
    if (stmt.op === "=" && stmt.decl !== "none") {
      const target = stmt.targets[0];
      if (!target || target.kind !== "ident") {
        throw new PineRuntimeError("`var` requires a simple variable name", "SCRIPT_ERROR", { line: stmt.line });
      }
      const frame = this.currentFrame();
      const existing = frame.get(target.name);
      if (existing) return existing.current;
      const value2 = this.evalExpr(stmt.expr);
      const slot = frame.declare(target.name, true);
      slot.current = value2;
      return value2;
    }
    const value = this.evalExpr(stmt.expr);
    if (stmt.op === "=") {
      this.assignTargets(stmt.targets, value, false, stmt.line);
      return value;
    }
    if (stmt.op === ":=") {
      this.assignTargets(stmt.targets, value, true, stmt.line);
      return value;
    }
    const current = this.readTarget(stmt.targets[0], stmt.line);
    const op = stmt.op.slice(0, 1);
    const combined = this.binary(op, current, value, stmt.line);
    this.assignTargets(stmt.targets, combined, true, stmt.line);
    return combined;
  }
  assignTargets(targets, value, reassign, line) {
    if (targets.length === 1) {
      const target = targets[0];
      if (target.kind === "ident") {
        this.writeIdent(target.name, value, reassign, line);
        return;
      }
      if (target.kind === "tuple") {
        const items = value instanceof PineTuple ? value.items : [];
        target.items.forEach((sub2, i) => this.assignTargets([sub2], items[i] ?? null, reassign, line));
        return;
      }
      if (target.kind === "member") {
        const object = this.evalExpr(target.object);
        if (!object || typeof object !== "object") {
          throw new PineRuntimeError("Cannot assign to a field of a non-object value", "TYPE_ERROR", { line });
        }
        if (object.__pine !== "udt") {
          throw new PineRuntimeError("Only user-defined-type fields can be assigned", "TYPE_ERROR", { line });
        }
        object[target.prop] = value;
        return;
      }
      throw new PineRuntimeError("Unsupported assignment target", "UNSUPPORTED_FEATURE", { line });
    }
    throw new PineRuntimeError("Unsupported assignment target list", "UNSUPPORTED_FEATURE", { line });
  }
  writeIdent(name, value, reassign, line) {
    if (reassign) {
      for (let i = this.scopePath.length; i >= 0; i--) {
        const path = this.scopePath.slice(0, i).join("/");
        const frame2 = this.frames.get(path);
        const slot2 = frame2?.get(name);
        if (slot2) {
          slot2.current = value;
          return;
        }
      }
      throw new PineRuntimeError(`Cannot reassign undeclared variable "${name}"`, "UNDECLARED_VARIABLE", { line });
    }
    const frame = this.currentFrame();
    const slot = frame.get(name) ?? frame.declare(name);
    slot.current = value;
  }
  readTarget(target, line) {
    if (target.kind === "ident") return this.lookupIdent(target.name, line);
    if (target.kind === "member") {
      const object = this.evalExpr(target.object);
      return object?.[target.prop] ?? null;
    }
    throw new PineRuntimeError("Unsupported compound-assignment target", "UNSUPPORTED_FEATURE", { line });
  }
  // -------------------------------------------------------------- expressions
  evalExpr(expr) {
    switch (expr.kind) {
      case "num":
        return expr.value;
      case "str":
        return expr.value;
      case "bool":
        return expr.value;
      case "na":
        return null;
      case "ident":
        return this.lookupIdent(expr.name, expr.line);
      case "member":
        return this.evalMember(expr, expr.line);
      case "call":
        return this.evalCall(expr);
      case "bin":
        return this.evalBinary(expr);
      case "un": {
        const v = this.evalExpr(expr.arg);
        if (expr.op === "not") {
          const b = toBool(v);
          return b === null ? null : !b;
        }
        const n2 = toNum(v);
        return n2 === null ? null : -n2;
      }
      case "ternary": {
        return this.cond(expr.cond) ? this.evalExpr(expr.then) : this.evalExpr(expr.else);
      }
      case "history": {
        if (this.isV6) {
          const base3 = expr.object;
          if (base3.kind === "num" || base3.kind === "str" || base3.kind === "bool") {
            throw new PineRuntimeError(
              "The [] operator cannot be applied to a literal value in Pine v6",
              "SCRIPT_ERROR",
              { line: expr.line }
            );
          }
        }
        const view = this.seriesOf(expr.object);
        const off = toNum(this.evalExpr(expr.offset));
        if (off === null) return null;
        return view.get(Math.trunc(off));
      }
      case "array":
        return new PineTuple(expr.items.map((item) => this.evalExpr(item)));
      case "tuple":
        return new PineTuple(expr.items.map((item) => this.evalExpr(item)));
      case "if": {
        const cond = this.cond(expr.cond);
        if (cond) return this.execScoped(expr.then, `if@${expr.line}:${expr.col}`);
        if (expr.else) return this.execScoped(expr.else, `else@${expr.line}:${expr.col}`);
        return null;
      }
      case "switch": {
        const subject = expr.subject ? this.evalExpr(expr.subject) : null;
        for (const c of expr.cases) {
          if (this.switchMatches(c, subject, expr.subject !== null)) return this.execCase(c, expr);
        }
        return null;
      }
      case "lambda":
        return { __pine: "lambda", params: expr.params, body: expr.body, exprBody: expr.exprBody, closureScope: this.scopePath.slice() };
      default:
        throw new PineRuntimeError(`Unsupported expression "${expr.kind}"`, "UNSUPPORTED_FEATURE", {
          line: expr.line
        });
    }
  }
  evalBinary(expr) {
    if (expr.op === "and") {
      const l = this.boolOperand(expr.left);
      if (!l && this.isV6) return false;
      const r = this.boolOperand(expr.right);
      return l && r;
    }
    if (expr.op === "or") {
      const l = this.boolOperand(expr.left);
      if (l && this.isV6) return true;
      const r = this.boolOperand(expr.right);
      return l || r;
    }
    const left = this.evalExpr(expr.left);
    const right = this.evalExpr(expr.right);
    return this.binary(expr.op, left, right, expr.line);
  }
  /** `and`/`or` operand: v6 requires a real boolean, v5 accepts anything truthy. */
  boolOperand(expr) {
    const value = this.evalExpr(expr);
    if (!this.isV6) return truthy(value);
    if (typeof value === "boolean") return value;
    if (value === null) return false;
    throw new PineRuntimeError(
      `The "and"/"or" operator needs "bool" operands, got "${typeof value}" (Pine v6)`,
      "TYPE_ERROR",
      { line: expr.line }
    );
  }
  /**
   * v1/v2 convert `true`/`false` to `1`/`0` in arithmetic; v3 forbade it ("Cannot call
   * `operator +` with arguments (series__bool, series__bool)") and v6 kept the refusal.
   */
  arithmeticOperand(value, op, line) {
    if (typeof value !== "boolean") return value;
    if (this.version <= 2) return value ? 1 : 0;
    throw new PineRuntimeError(
      `Cannot call \`operator ${op}\` with a bool operand; v3 removed the implicit bool to number cast`,
      "TYPE_ERROR",
      { line }
    );
  }
  binary(op, left, right, line) {
    switch (op) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%": {
        const l = this.arithmeticOperand(left, op, line);
        const r = this.arithmeticOperand(right, op, line);
        if (op === "+") return add(l, r);
        if (op === "-") return sub(l, r);
        if (op === "*") return mul(l, r);
        if (op === "/") return div(l, r, this.isV6);
        return mod(l, r);
      }
      case "==":
        return eq(left, right);
      case "!=":
        return !eq(left, right);
      case ">":
      case "<":
      case ">=":
      case "<=":
        return cmp(op, left, right);
      default:
        throw new PineRuntimeError(`Unknown operator "${op}"`, "SCRIPT_ERROR", { line });
    }
  }
  lookupIdent(name, line) {
    for (let i = this.scopePath.length; i >= 0; i--) {
      const path = this.scopePath.slice(0, i).join("/");
      const frame = this.frames.get(path);
      const slot = frame?.get(name);
      if (slot) return slot.current;
    }
    if (name === "na") return null;
    const zeroArg = BUILTINS.get(name);
    if (zeroArg) {
      const synthetic = {
        kind: "call",
        callee: { kind: "ident", name, line, col: 0 },
        args: [],
        id: this.nodeKey({ kind: "ident", name, line, col: 0 }),
        line,
        col: 0
      };
      return zeroArg(this.callSite(synthetic, name));
    }
    const legacyType = legacyInputType(name, this.version);
    if (legacyType) return legacyType;
    const legacy = legacyValue(name, this.version);
    if (legacy) return this.resolveLegacyIdent(legacy, line);
    throw new PineRuntimeError(`Undeclared identifier "${name}"`, "UNDECLARED_VARIABLE", { line });
  }
  /** Resolve a legacy name that maps onto a v5 namespace member (`color.red`, `ta.tr`, …). */
  resolveLegacyIdent(path, line) {
    const dot = path.indexOf(".");
    if (dot < 0) {
      const slot = this.findSlot(path);
      if (slot) return slot.current;
      const zeroArg = BUILTINS.get(path);
      if (zeroArg) {
        const synthetic = {
          kind: "call",
          callee: { kind: "ident", name: path, line, col: 0 },
          args: [],
          id: this.nodeKey({ kind: "ident", name: path, line, col: 0 }),
          line,
          col: 0
        };
        return zeroArg(this.callSite(synthetic, path));
      }
      return null;
    }
    const ns = path.slice(0, dot);
    const prop = path.slice(dot + 1);
    const constant = resolveConstant(ns, prop);
    if (constant !== void 0) return constant;
    const builtin = BUILTINS.get(path);
    if (builtin) {
      const synthetic = {
        kind: "call",
        callee: { kind: "ident", name: path, line, col: 0 },
        args: [],
        id: this.nodeKey({ kind: "ident", name: path, line, col: 0 }),
        line,
        col: 0
      };
      return builtin(this.callSite(synthetic, path));
    }
    return resolveMember(this, { kind: "ident", name: ns, line, col: 0 }, prop, line);
  }
  evalMember(expr, line) {
    if (expr.object.kind === "ident" && expr.object.name === "input" && this.version <= 4) {
      const type = legacyInputType(expr.prop, this.version);
      if (type) return type;
    }
    if (expr.object.kind === "member" && expr.object.object.kind === "ident") {
      const alias = expr.object.object.name;
      const members = this.libraryEnums.get(alias)?.get(expr.object.prop);
      if (members) {
        if (!members.has(expr.prop)) {
          throw new PineRuntimeError(`Enum "${alias}.${expr.object.prop}" has no member "${expr.prop}"`, "UNDECLARED_VARIABLE", {
            line
          });
        }
        return members.get(expr.prop);
      }
    }
    if (expr.object.kind === "ident") {
      const libEnums = this.currentLibrary() ? this.libraryEnums.get(this.currentLibrary()) : void 0;
      const members = libEnums?.get(expr.object.name) ?? this.enums.get(expr.object.name);
      if (members) {
        if (!members.has(expr.prop)) {
          throw new PineRuntimeError(`Enum "${expr.object.name}" has no member "${expr.prop}"`, "UNDECLARED_VARIABLE", {
            line
          });
        }
        return members.get(expr.prop);
      }
    }
    if (expr.object.kind === "ident" && expr.object.name === "ta") {
      const key = `ta.${expr.prop}`;
      const builtin = BUILTINS.get(key);
      if (builtin) {
        const synthetic = {
          kind: "call",
          callee: { kind: "ident", name: key, line: expr.line, col: expr.col },
          args: [],
          id: this.nodeKey(expr),
          line: expr.line,
          col: expr.col
        };
        return builtin(this.callSite(synthetic, key));
      }
    }
    return resolveMember(this, expr.object, expr.prop, line);
  }
  /** Resolve an object value to a member (used by `resolveMember`). */
  evalObject(expr) {
    return this.evalExpr(expr);
  }
  // -------------------------------------------------------------- series views
  nodeKey(expr) {
    let id = this.nodeIds.get(expr);
    if (id === void 0) {
      id = this.nextNodeId++;
      this.nodeIds.set(expr, id);
    }
    return id;
  }
  /** Obtain a series view for an expression, recording per-bar values when necessary. */
  seriesOf(expr) {
    if (expr.kind === "ident") {
      const slot = this.findSlot(expr.name);
      if (slot) return slot.view();
      return constantSeries(this.lookupIdent(expr.name, expr.line));
    }
    if (expr.kind === "history") {
      const base3 = this.seriesOf(expr.object);
      const off = toNum(this.evalExpr(expr.offset));
      const shift = off === null ? 0 : Math.trunc(off);
      return { get: (o) => base3.get(o + shift), known: base3.known };
    }
    if (expr.kind === "num" || expr.kind === "str" || expr.kind === "bool" || expr.kind === "na") {
      return constantSeries(this.evalExpr(expr));
    }
    const key = this.nodeKey(expr);
    let arr2 = this.exprHistory.get(key);
    if (!arr2) {
      arr2 = [];
      this.exprHistory.set(key, arr2);
    }
    const existing = arr2[this.barIndex];
    const value = existing === void 0 ? this.evalExpr(expr) : existing;
    arr2[this.barIndex] = value;
    return recordedSeries(arr2, this.barIndex);
  }
  findSlot(name) {
    for (let i = this.scopePath.length; i >= 0; i--) {
      const path = this.scopePath.slice(0, i).join("/");
      const slot = this.frames.get(path)?.get(name);
      if (slot) return slot;
    }
    return void 0;
  }
  // ------------------------------------------------------------------- calls
  evalCall(expr) {
    if (this.isV6) {
      const seen = /* @__PURE__ */ new Set();
      const calleePath = calleePathOf(expr.callee);
      for (const arg of expr.args) {
        if (arg.name === void 0) continue;
        if (arg.name === "when" && calleePath.startsWith("strategy.") && this.version >= 5) {
          throw new PineRuntimeError(
            `'${calleePath}' has no 'when' parameter since Pine v5; guard the call with an 'if'`,
            "TYPE_ERROR",
            { line: expr.line }
          );
        }
        if (seen.has(arg.name)) {
          throw new PineRuntimeError(`Argument "${arg.name}" is bound twice in the same call`, "TYPE_ERROR", {
            line: expr.line
          });
        }
        seen.add(arg.name);
      }
    }
    const callee = expr.callee;
    if (callee.kind === "member") {
      const path = memberPath(callee);
      if (path.includes(".")) {
        const builtin = BUILTINS.get(path);
        if (builtin) return builtin(this.callSite(expr, path));
      }
    }
    if (callee.kind === "member" && callee.prop === "new" && callee.object.kind === "member" && callee.object.object.kind === "ident") {
      const qualified = `${callee.object.object.name}.${callee.object.prop}`;
      const fields = this.userTypes.get(qualified);
      if (fields) return this.constructUserType(qualified, fields, expr.args);
    }
    if (callee.kind === "member" && callee.object.kind === "ident") {
      const nsName = callee.object.name;
      if (callee.prop === "new") {
        const current = this.currentLibrary();
        const fields = this.userTypes.get(nsName) ?? (current ? this.libraryTypes.get(current)?.get(nsName) : void 0);
        if (fields) return this.constructUserType(nsName, fields, expr.args);
      }
      const libNs = this.namespaces.get(nsName);
      if (libNs) {
        const fn = libNs.get(callee.prop);
        if (fn) return this.callUserFunction(fn, expr.args, expr.id, expr.line, void 0, nsName);
        throw new PineRuntimeError(`Unknown function "${nsName}.${callee.prop}"`, "UNKNOWN_FUNCTION", { line: expr.line });
      }
      const key = `${nsName}.${callee.prop}`;
      const builtin = BUILTINS.get(key);
      if (builtin) return builtin(this.callSite(expr, key));
      if (KNOWN_NAMESPACES.has(nsName)) {
        throw new PineRuntimeError(`Unknown function "${key}"`, "UNKNOWN_FUNCTION", { line: expr.line });
      }
      const objValue = this.evalExpr(callee.object);
      const methodKey = `${objValue?.__pine}.${callee.prop}`;
      const method = BUILTINS.get(methodKey);
      if (method) return method(this.callSite(expr, methodKey, objValue));
      const libMethod = this.libraryMethod(callee.prop) ?? this.libraryExportedMethods.get(callee.prop);
      const userMethod = this.methods.get(callee.prop) ?? libMethod;
      if (userMethod) return this.callUserFunction(userMethod, expr.args, expr.id, expr.line, [objValue], this.libraryMethod(callee.prop) ? this.currentLibrary() : void 0);
      throw new PineRuntimeError(`Unknown function "${key}"`, "UNKNOWN_FUNCTION", { line: expr.line });
    }
    if (callee.kind === "ident") {
      const typeFields = this.userTypes.get(callee.name);
      if (typeFields) return this.constructUserType(callee.name, typeFields, expr.args);
      const userFn = this.functions.get(callee.name);
      if (userFn) return this.callUserFunction(userFn, expr.args, expr.id, expr.line);
      const libFn = this.libraryOwnFunction(callee.name);
      if (libFn) return this.callUserFunction(libFn, expr.args, expr.id, expr.line, void 0, this.currentLibrary());
      if (callee.name === "color" && this.version <= 3) {
        const channel = (i) => toNum(this.evalExpr(expr.args[i]?.value ?? { kind: "num", value: 0, line: expr.line, col: 0 })) ?? 0;
        return colorFromRgba(channel(0), channel(1), channel(2), channel(3));
      }
      const legacy = legacyCall(callee.name, this.version);
      if (legacy) {
        const target = BUILTINS.get(legacy);
        if (target) return target(this.callSite(expr, legacy));
      }
      if (callee.name === "iff" && this.version <= 4) {
        const cond = truthy(this.evalExpr(expr.args[0]?.value ?? { kind: "na", line: expr.line, col: 0 }));
        const branch = cond ? expr.args[1] : expr.args[2];
        return branch ? this.evalExpr(branch.value) : null;
      }
      if (callee.name === "offset" && this.version <= 4) {
        const view = this.seriesOf(expr.args[0]?.value ?? { kind: "na", line: expr.line, col: 0 });
        const off = toNum(this.evalExpr(expr.args[1]?.value ?? { kind: "num", value: 0, line: expr.line, col: 0 }));
        return off === null ? null : view.get(Math.trunc(off));
      }
      const builtin = BUILTINS.get(callee.name);
      if (builtin) return builtin(this.callSite(expr, callee.name));
      throw new PineRuntimeError(`Unknown function "${callee.name}"`, "UNKNOWN_FUNCTION", { line: expr.line });
    }
    if (callee.kind === "member") {
      const receiver = this.evalExpr(callee.object);
      const key = `${receiver?.__pine}.${callee.prop}`;
      const method = BUILTINS.get(key);
      if (method) return method(this.callSite(expr, key, receiver));
      const libMethod = this.libraryMethod(callee.prop) ?? this.libraryExportedMethods.get(callee.prop);
      const userMethod = this.methods.get(callee.prop) ?? libMethod;
      if (userMethod) {
        return this.callUserFunction(userMethod, expr.args, expr.id, expr.line, [receiver], libMethod ? this.currentLibrary() : void 0);
      }
      throw new PineRuntimeError(`Unknown function "${memberPath(callee)}"`, "UNKNOWN_FUNCTION", { line: expr.line });
    }
    const fnValue = this.evalExpr(callee);
    if (fnValue && fnValue.__pine === "lambda") {
      return this.callLambda(fnValue, expr.args, expr.line);
    }
    throw new PineRuntimeError("Expression is not callable", "TYPE_ERROR", { line: expr.line });
  }
  /** The alias of the library whose body is currently executing. */
  currentLibrary() {
    return this.libraryStack[this.libraryStack.length - 1];
  }
  /** A library's own (exported or private) function, looked up by bare name. */
  libraryOwnFunction(name) {
    const alias = this.currentLibrary();
    return alias ? this.libraryFunctions.get(alias)?.get(name) : void 0;
  }
  /** A `method` declared in the library whose body is executing. */
  libraryMethod(name) {
    const alias = this.currentLibrary();
    return alias ? this.libraryMethods.get(alias)?.get(name) : void 0;
  }
  callSite(expr, name, receiver) {
    this.rejectRemovedArgs(name, expr);
    return new CallSiteImpl(this, expr, `${this.scopePath.join("/")}::${expr.id}`, name, receiver);
  }
  /**
   * Arguments Pine removed in v5/v6 are a compile error, not silently ignored. Only the
   * removals with a documented replacement are listed; a general unknown-argument check
   * needs a full signature table for every builtin (see `docs/known-limitations.md`).
   */
  rejectRemovedArgs(name, expr) {
    if (name === "input" && this.version >= 5) {
      throw new PineRuntimeError(
        "input() was split into input.int()/input.float()/input.bool()/\u2026 in Pine v5",
        "TYPE_ERROR",
        { line: expr.line }
      );
    }
    const family = name.split(".")[0] ?? name;
    for (const arg of expr.args) {
      if (arg.name === void 0) continue;
      if (arg.name === "transp" && TRANSP_FAMILIES.has(family) && this.version >= 5) {
        throw new PineRuntimeError(
          `'${name}' has no 'transp' parameter since Pine v5; use color.new(color, transp)`,
          "TYPE_ERROR",
          { line: expr.line }
        );
      }
      if (arg.name === "resolution" && family === "request" && this.version >= 5) {
        throw new PineRuntimeError(
          `'${name}' has no 'resolution' parameter since Pine v5; the parameter is called 'timeframe'`,
          "TYPE_ERROR",
          { line: expr.line }
        );
      }
    }
  }
  /** Internal: per-call-site persistent state (see `CallSite.state`). */
  callState(key, init) {
    let value = this.callStates.get(key);
    if (value === void 0) {
      value = init();
      this.callStates.set(key, value);
    }
    return value;
  }
  warn(method, message) {
    if (!this.warnings.some((w) => w.method === method && w.message === message)) {
      this.warnings.push({ message, method, bar: this.barIndex });
    }
  }
  callUserFunction(fn, args, callId, line, preEvaluated, library) {
    if (this.callDepth > 64) throw new PineRuntimeError("Maximum call depth exceeded", "SCRIPT_ERROR", { line });
    const path = this.childPath(`fn:${callId}`);
    let frame = this.frames.get(path);
    if (!frame) {
      frame = new Frame(path);
      this.frames.set(path, frame);
    }
    for (const [name, slot] of [...frame.slots]) if (!slot.persistent) frame.slots.delete(name);
    const offset = preEvaluated ? preEvaluated.length : 0;
    const provided = fn.params.map((param, i) => {
      if (preEvaluated && i < preEvaluated.length) return { value: preEvaluated[i] };
      const named = args.find((a) => a.name === param.name);
      if (named) return { value: this.evalExpr(named.value) };
      const positional = args[i - offset];
      if (positional && positional.name === void 0) return { value: this.evalExpr(positional.value) };
      return null;
    });
    this.scopePath.push(`fn:${callId}`);
    this.callDepth++;
    if (library) this.libraryStack.push(library);
    try {
      fn.params.forEach((param, i) => {
        const slot = frame.get(param.name) ?? frame.declare(param.name);
        const explicit = provided[i];
        slot.current = explicit ? explicit.value : param.def ? this.evalExpr(param.def) : null;
      });
      if (fn.exprBody) return this.evalExpr(fn.exprBody);
      try {
        return this.execBlock(fn.body);
      } catch (err) {
        if (err instanceof ReturnSignal) return err.value;
        throw err;
      }
    } finally {
      if (library) this.libraryStack.pop();
      this.callDepth--;
      this.scopePath.pop();
    }
  }
  /** Invoke a lambda value with already-evaluated arguments (used by `array.every`…). */
  callLambdaValue(fn, values, line) {
    const lambda = fn;
    const saved = this.scopePath;
    this.scopePath = lambda.closureScope.slice();
    this.scopePath.push(`lambda@${line}:${this.nextNodeId++}`);
    const frame = this.currentFrame();
    lambda.params.forEach((param, i) => {
      const slot = frame.get(param.name) ?? frame.declare(param.name);
      slot.current = values[i] ?? null;
    });
    try {
      if (lambda.exprBody) return this.evalExpr(lambda.exprBody);
      return this.execBlock(lambda.body);
    } finally {
      for (const [name, slot] of [...frame.slots]) if (!slot.persistent) frame.slots.delete(name);
      this.scopePath = saved;
    }
  }
  callLambda(fn, args, line) {
    const saved = this.scopePath;
    this.scopePath = fn.closureScope.slice();
    const tag = `lambda@${line}:${this.nextNodeId++}`;
    this.scopePath.push(tag);
    const frame = this.currentFrame();
    fn.params.forEach((param, i) => {
      const slot = frame.get(param.name) ?? frame.declare(param.name);
      const arg = args[i];
      slot.current = arg ? this.evalExpr(arg.value) : null;
    });
    try {
      if (fn.exprBody) return this.evalExpr(fn.exprBody);
      return this.execBlock(fn.body);
    } finally {
      for (const [name, slot] of [...frame.slots]) if (!slot.persistent) frame.slots.delete(name);
      this.scopePath = saved;
    }
  }
  // --------------------------------------------------------------- public API
  get bar() {
    return this.bars[this.barIndex];
  }
  /** Bar interval in milliseconds, inferred from the data. */
  barDurationMs() {
    return barDurationMs(this.bars);
  }
  /** The bar currently executing (alias kept for the drawing builtins). */
  get currentBar() {
    return this.bars[this.barIndex];
  }
  get inputOverrides() {
    return this.config.inputs;
  }
  get propOverrides() {
    return this.config.props;
  }
  inputKeyFor(callId) {
    return this.config.inputKeys.get(callId);
  }
  get securityData() {
    return this.config.securityData;
  }
  get maxBarsBack() {
    return this.config.maxBarsBack;
  }
  /** Bar index of the oldest bar in this run (always 0 for a full pass). */
  get firstIndex() {
    return 0;
  }
  firstBar(key, init) {
    void this.firstBarCache;
    void key;
    return init();
  }
  getBarAt(index) {
    return this.bars[index];
  }
  /** Series view for a named variable (builtin or script variable). */
  seriesByName(name) {
    const slot = this.findSlot(name);
    return slot ? slot.view() : constantSeries(null);
  }
  /** Value of a named variable on the current bar (na when unknown). */
  valueByName(name) {
    return this.findSlot(name)?.current ?? null;
  }
  /** Current bar index within this run (0-based). */
  get index() {
    return this.barIndex;
  }
  /** The full bar array of this run. */
  get allBars() {
    return this.bars;
  }
  /** All input override values (keyed by input key). */
  get inputs() {
    return this.config.inputs;
  }
  securityRuns = /* @__PURE__ */ new Map();
  /**
   * Evaluate a `request.security` expression in a secondary context bound to another
   * symbol/timeframe, then align it to the chart's bars.
   */
  /**
   * `request.security_lower_tf`: every lower-timeframe value inside the current bar's
   * window, as a Pine array. Uses the same host-prefetched series as `request.security`.
   */
  lowerTfValues(callId, symbol, timeframe, expr) {
    let run = this.securityRuns.get(callId);
    if (!run) {
      const key = `${symbol}|${timeframe}`;
      const bars = this.config.securityData.get(key) ?? [];
      if (bars.length === 0 || !bars.some((bar) => Number.isFinite(bar.close))) {
        this.warn(
          `request.security_lower_tf(${symbol}, ${timeframe})`,
          "no usable data was provided for this symbol/timeframe; the call returns na"
        );
        run = { values: [], bars: [] };
      } else {
        const body = [{ kind: "expr", expr, line: expr.line, col: expr.col }];
        const sub2 = new _Runtime({
          ...this.config,
          script: { version: this.script.version, body },
          bars,
          market: { ...this.market, symbol, timeframe }
        });
        const values = [];
        for (let i = 0; i < bars.length; i++) values.push(sub2.step(i));
        run = { values, bars };
      }
      this.securityRuns.set(callId, run);
    }
    const primary = this.bars[this.barIndex];
    if (!primary || run.bars.length === 0) return new PineArray([], "float");
    const from = primary.time;
    const to = this.bars[this.barIndex + 1]?.time ?? Number.POSITIVE_INFINITY;
    const items = run.bars.map((bar, i) => ({ bar, value: run.values[i] ?? null })).filter((entry) => entry.bar.time >= from && entry.bar.time < to).map((entry) => entry.value).filter((v) => v !== null && !(typeof v === "number" && Number.isNaN(v)));
    return new PineArray(items, "float");
  }
  switchContext(callId, symbol, timeframe, expr, lookahead) {
    let run = this.securityRuns.get(callId);
    if (!run) {
      const key = `${symbol}|${timeframe}`;
      const bars = this.config.securityData.get(key) ?? [];
      if (bars.length === 0 || !bars.some((bar) => Number.isFinite(bar.close))) {
        this.warn(
          `request.security(${symbol}, ${timeframe})`,
          "no usable data was provided for this symbol/timeframe; the call returns na"
        );
        run = { values: [], bars: [] };
      } else {
        const body = [{ kind: "expr", expr, line: expr.line, col: expr.col }];
        const sub2 = new _Runtime({
          ...this.config,
          script: { version: this.script.version, body },
          bars,
          market: { ...this.market, symbol, timeframe }
        });
        const values = [];
        for (let i = 0; i < bars.length; i++) values.push(sub2.step(i));
        run = { values, bars };
      }
      this.securityRuns.set(callId, run);
    }
    if (run.values.length === 0) return null;
    const primary = this.bars[this.barIndex];
    if (!primary) return null;
    const step = barDurationMs(run.bars) || Math.round(tfMinutes(timeframe) * 6e4);
    const idx = lookahead ? lastAtOrBefore(run.bars, primary.time) : lastClosed(run.bars, primary.time, step);
    if (idx < 0) return null;
    return run.values[idx] ?? null;
  }
  /** Declaration info (indicator()/strategy() arguments). */
  get decl() {
    return this.declaration;
  }
};
function findArg(args, index, name) {
  if (name) {
    const named = args.find((a) => a.name === name);
    if (named) return named.value;
  }
  const positional = args.filter((a) => a.name === void 0);
  return positional[index]?.value;
}
function isoWeek(d) {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1e3));
}
function lastAtOrBefore(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (bars[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
function lastClosed(bars, t, step) {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const next = bars[mid + 1];
    const closedAt = next ? next.time : bars[mid].time + step;
    if (closedAt <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
var TRANSP_FAMILIES = /* @__PURE__ */ new Set(["plot", "plotshape", "plotchar", "plotcandle", "plotbar", "hline", "fill", "bgcolor", "barcolor", "label", "line", "box", "table"]);
var CallSiteImpl = class {
  rt;
  id;
  args;
  line;
  col;
  receiver;
  key;
  constructor(rt, expr, key, name, receiver) {
    this.rt = rt;
    this.id = expr.id;
    this.args = expr.args;
    this.line = expr.line;
    this.col = expr.col;
    this.key = key;
    this.name = name;
    if (receiver !== void 0) this.receiver = receiver;
  }
  name;
  /** Look up an argument, accepting its v1–v4 name for a script of that version. */
  find(index, argName) {
    const named = argName ? this.args.find((a) => a.name === argName) : void 0;
    if (named) return named.value;
    if (argName && this.rt.version <= 4) {
      const legacy = legacyParamFor(argName);
      const aliased = legacy ? this.args.find((a) => a.name === legacy) : void 0;
      if (aliased) return aliased.value;
    }
    if (index === void 0) return void 0;
    return findArg(this.args, index, void 0);
  }
  arg(index, argName) {
    const target = this.find(index, argName);
    const value = target ? this.rt.evalExpr(target) : null;
    if (argName === "color" && this.rt.version <= 4) {
      const transp = this.find(void 0, "transp");
      if (transp) {
        const amount = toNum(this.rt.evalExpr(transp));
        if (value instanceof PineColor && amount !== null) return value.withTransp(amount);
      }
    }
    return value;
  }
  argExpr(index, argName) {
    return this.find(index, argName);
  }
  argSeries(index, argName) {
    const target = this.find(index, argName);
    return target ? this.rt.seriesOf(target) : constantSeries(null);
  }
  has(argName) {
    if (this.args.some((a) => a.name === argName)) return true;
    if (this.rt.version > 4) return false;
    const legacy = legacyParamFor(argName);
    return legacy ? this.args.some((a) => a.name === legacy) : false;
  }
  state(init) {
    return this.rt.callState(this.key, init);
  }
  evalExpr(expr) {
    return this.rt.evalExpr(expr);
  }
  warn(message) {
    this.rt.warn(this.name, message);
  }
};

// src/engine/PineEngine.ts
var PineEngine = class {
  language = "pine";
  capabilities = { streaming: true, visibleRange: false, inputs: true, props: true };
  options;
  constructor(options = {}) {
    this.options = options;
  }
  async prepare(source, instanceId) {
    const script = parseScript(source);
    assertSupportedVersion(script);
    if (script.body.length === 0) {
      throw new PineSyntaxError("the script is empty: a Pine script needs at least a declaration", 1, 1);
    }
    const analyzed = analyze(script, {
      instanceId,
      market: { symbol: "", timeframe: "" },
      ...this.options.defaultProps ? { defaultProps: this.options.defaultProps } : {}
    });
    const libraries = await this.resolveImports(script, analyzed.imports, this.options.importResolver);
    const props = this.visibleProps(analyzed);
    const prepared = {
      language: this.language,
      inputs: analyzed.inputs,
      meta: analyzed.meta,
      reactsToViewport: analyzed.reactsToViewport,
      token: { source, instanceId, analyzed, libraries }
    };
    if (props.length > 0) prepared.props = props;
    return prepared;
  }
  visibleProps(analyzed) {
    const visibility = this.options.props ?? "all";
    if (visibility === "none") return [];
    if (visibility === "strategy" && !analyzed.isStrategy) return [];
    if (Array.isArray(visibility)) {
      const allowed = new Set(visibility);
      return analyzed.props.filter((p) => allowed.has(p.key));
    }
    return analyzed.props;
  }
  async resolveImports(script, imports, resolver, out = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set()) {
    for (const imp of imports) {
      if (seen.has(imp.alias)) continue;
      seen.add(imp.alias);
      if (!resolver) {
        throw new PineRuntimeError(
          `script imports "${imp.path}" but no importResolver was provided`,
          "IMPORT_ERROR"
        );
      }
      const parts = imp.path.split("/");
      const info = {
        user: parts[0] ?? "",
        name: parts[1] ?? "",
        version: parts[2] ?? ""
      };
      const source = await resolver(imp.path, info);
      if (source === null || source === void 0) {
        throw new PineRuntimeError(`the importResolver does not know the library "${imp.path}"`, "IMPORT_ERROR");
      }
      const libScript = parseScript(source);
      out.set(imp.alias, libScript.body);
      const nested = libScript.body.filter((s2) => s2.kind === "import");
      if (nested.length > 0) {
        await this.resolveImports(libScript, nested.map((n2) => ({ path: n2.path, alias: n2.alias })), resolver, out, seen);
      }
    }
    void script;
    return out;
  }
  execute(req, handlers) {
    const token = req.prepared.token;
    if (!token || typeof token !== "object" || !("analyzed" in token)) {
      throw new PineRuntimeError("execute() needs a script produced by this engine's prepare()", "SCRIPT_ERROR");
    }
    return new EngineSession(this, token, req, handlers);
  }
  /** Internal: run one full pass and return the model. */
  async runOnce(token, req, inputs, props) {
    const bars = req.bars ?? [];
    if (this.options.maxBars !== void 0 && bars.length > this.options.maxBars) {
      throw new PineRuntimeError(`the dataset has ${bars.length} bars, above the configured limit of ${this.options.maxBars}`, "INVALID_ARGUMENT");
    }
    const analyzed = token.analyzed;
    const propValues = { ...analyzed.propDefaults, ...props };
    const inputValues = { ...analyzed.inputDefaults, ...inputs };
    const securityData = /* @__PURE__ */ new Map();
    if (analyzed.securityCalls.length > 0 && req.fetchSeries) {
      const env = constEnvFor(req.market, analyzed.inputDefaults);
      const wanted = /* @__PURE__ */ new Map();
      const bindings = /* @__PURE__ */ new Map();
      for (const stmt of analyzed.script.body) {
        if (stmt.kind === "assign" && stmt.op === "=" && stmt.targets.length === 1) {
          const target = stmt.targets[0];
          if (target && target.kind === "ident") bindings.set(target.name, stmt.expr);
        }
      }
      env.bindings = bindings;
      for (const call of analyzed.securityCalls) {
        let symbol;
        let timeframe;
        try {
          symbol = toStr(evalConst(call.symbolExpr, env));
          timeframe = toStr(evalConst(call.timeframeExpr, env));
        } catch {
          throw new PineRuntimeError(
            "request.security() needs constant symbol and timeframe arguments so the data can be fetched before the run",
            "UNSUPPORTED_FEATURE"
          );
        }
        if (!symbol || !timeframe) continue;
        wanted.set(`${symbol}|${timeframe}`, { symbol, timeframe });
      }
      for (const [key, request] of wanted) {
        try {
          const series = await req.fetchSeries(request.symbol, request.timeframe, {
            from: bars[0]?.time,
            to: bars[bars.length - 1]?.time
          });
          securityData.set(key, Array.isArray(series) ? series : []);
        } catch (err) {
          throw new PineRuntimeError(
            `fetchSeries failed for ${request.symbol}/${request.timeframe}: ${err.message}`,
            "SCRIPT_ERROR"
          );
        }
      }
    }
    const meta = { ...analyzed.meta };
    const precisionProp = propValues["precision"];
    if (typeof precisionProp === "number") meta.precision = precisionProp;
    const broker = {
      initialCapital: numberProp(propValues["initial_capital"], 1e6),
      commissionType: stringProp(propValues["commission_type"], "percent") ?? "percent",
      commissionValue: numberProp(propValues["commission_value"], 0),
      slippage: numberProp(propValues["slippage"], 0),
      qtyType: stringProp(propValues["default_qty_type"], "fixed"),
      qtyValue: numberProp(propValues["default_qty_value"], 1),
      processOnClose: Boolean(propValues["process_orders_on_close"] ?? false),
      pyramiding: numberProp(propValues["pyramiding"], 0)
    };
    const runtime = new Runtime({
      script: analyzed.script,
      bars,
      market: req.market,
      declaration: {
        title: meta.title,
        ...meta.shorttitle !== void 0 ? { shorttitle: meta.shorttitle } : {},
        overlay: meta.overlay,
        ...meta.precision !== void 0 ? { precision: meta.precision } : {},
        ...meta.format !== void 0 ? { format: meta.format } : {},
        isStrategy: analyzed.isStrategy,
        broker
      },
      inputs: inputValues,
      inputKeys: analyzed.inputKeys,
      props: propValues,
      libraries: token.libraries,
      securityData,
      ...typeof propValues["max_bars_back"] === "number" ? { maxBarsBack: propValues["max_bars_back"] } : {}
    });
    const result = runtime.run();
    const trades = result.broker ? result.broker.fills : void 0;
    const model = buildModel(result.sink, bars, {
      instanceId: token.instanceId,
      meta,
      inputs: analyzed.inputs,
      inputValues,
      ...this.visibleProps(analyzed).length > 0 ? { props: this.visibleProps(analyzed), propValues } : {},
      ...trades && trades.length > 0 ? { trades } : {},
      drawings: runtime.drawings
    });
    const snapshot = buildSnapshot(runtime, result, meta, "idle", analyzed);
    return {
      model,
      snapshot,
      state: { runtime, model },
      alerts: collectAlerts(runtime),
      warnings: runtime.warnings.slice()
    };
  }
};
function numberProp(v, def) {
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : def;
}
function stringProp(v, def) {
  return typeof v === "string" ? v : v === void 0 ? def : toStr(v);
}
function collectAlerts(runtime) {
  return runtime.pendingAlerts.slice(0, 5e3);
}
function buildSnapshot(runtime, result, meta, phase, analyzed) {
  void analyzed;
  const plots = {};
  const bars = runtime.bars;
  for (const rec of result.sink.lines.values()) {
    const points = rec.values.map((value, i) => ({ time: bars[i]?.time ?? 0, value }));
    plots[rec.title] = points;
  }
  const variables = {};
  for (const [name, value] of result.globals) {
    if (BUILTIN_SERIES.has(name)) continue;
    variables[name] = serializable(value);
  }
  const snapshot = {
    language: "pine",
    phase,
    barIndex: result.barIndex,
    meta: {
      title: meta.title,
      overlay: meta.overlay,
      ...meta.precision !== void 0 ? { precision: meta.precision } : {},
      ...meta.shorttitle !== void 0 ? { shorttitle: meta.shorttitle } : {}
    },
    plots,
    variables,
    warnings: runtime.warnings.slice()
  };
  if (result.broker) {
    snapshot.strategy = result.broker.state();
    const trades = result.broker.trades();
    if (trades.length > 0) snapshot.trades = trades;
  }
  return snapshot;
}
var BUILTIN_SERIES = /* @__PURE__ */ new Set([
  "open",
  "high",
  "low",
  "close",
  "volume",
  "time",
  "bar_index",
  "hl2",
  "hlc3",
  "ohlc4",
  "hlcc4",
  "last_bar_index",
  "last_bar_time",
  "hour",
  "minute",
  "second",
  "dayofmonth",
  "dayofweek",
  "month",
  "year",
  "weekofyear",
  "time_close"
]);
function serializable(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "object" && "__pine" in value) {
    const tag = value.__pine;
    if (tag === "array") {
      return (value.items ?? []).map(serializable);
    }
    if (tag === "tuple") {
      return (value.items ?? []).map(serializable);
    }
    return `<${tag}>`;
  }
  return String(value);
}
var EngineSession = class {
  constructor(engine, token, req, handlers) {
    this.engine = engine;
    this.token = token;
    this.req = req;
    this.handlers = handlers;
    this.inputs = { ...req.inputs ?? {} };
    this.props = { ...req.props ?? {} };
    this.pendingHistory = req.historyState === "backfill" ? "complete" : null;
    if (this.pendingHistory === null) void this.run();
    else this.phase = "computing";
  }
  engine;
  token;
  req;
  handlers;
  stopped = false;
  phase = "idle";
  generation = 0;
  inputs;
  props;
  lastSnapshot = null;
  pendingHistory;
  getContext = async (select) => {
    if (!this.lastSnapshot) return null;
    const snapshot = this.lastSnapshot;
    if (!select) return snapshot;
    const out = {};
    for (const key of select) {
      if (key in snapshot) out[key] = snapshot[key];
    }
    return out;
  };
  stop() {
    this.stopped = true;
    this.generation++;
    this.phase = "idle";
    if (this.lastSnapshot) this.lastSnapshot = { ...this.lastSnapshot, phase: "idle" };
  }
  update(inputs, props) {
    if (this.stopped) return;
    this.inputs = { ...this.inputs, ...inputs };
    if (props) this.props = { ...this.props, ...props };
    void this.run();
  }
  setVisibleRange() {
  }
  notifyBars(reason) {
    if (this.stopped) return;
    if (reason === "backfill") return;
    if (this.pendingHistory === "complete" && reason === "complete") {
      this.pendingHistory = null;
      void this.run();
      return;
    }
    void this.run();
  }
  async run() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.phase = "computing";
    const bars = this.req.getBars ? this.req.getBars() : this.req.bars;
    try {
      const result = await this.engine.runOnce(this.token, { ...this.req, bars }, this.inputs, this.props);
      if (this.stopped || generation !== this.generation) return;
      this.lastSnapshot = { ...result.snapshot, phase: this.req.mode === "live" ? "streaming" : "idle" };
      this.phase = this.req.mode === "live" ? "streaming" : "idle";
      for (const warning of result.warnings) this.handlers.onWarning?.(warning);
      for (const alert of result.alerts) this.handlers.onAlert?.(alert);
      this.handlers.onModel(result.model);
      if (this.req.mode !== "live") this.handlers.onDone?.();
    } catch (err) {
      if (this.stopped || generation !== this.generation) return;
      this.phase = "idle";
      this.handlers.onError?.(normalizeError(err));
    }
  }
};
function normalizeError(err) {
  if (err instanceof PineRuntimeError) {
    const out = new Error(err.describe());
    out.name = err.code;
    return out;
  }
  if (err instanceof PineSyntaxError) {
    const out = new Error(`${err.message} (line ${err.line}, column ${err.col})`);
    out.name = err.code;
    return out;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

// src/worker/PineWorkerEngine.ts
var PineWorkerEngine = class {
  constructor(options = {}) {
    this.options = options;
  }
  options;
  language = "pine";
  capabilities = { streaming: true, visibleRange: false, inputs: true, props: true };
  worker = null;
  pendingPrepares = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  keySeq = 0;
  sessionSeq = 0;
  contextSeq = 0;
  disposed = false;
  // ------------------------------------------------------------------ lifecycle
  ensureWorker() {
    if (this.worker) return this.worker;
    const factory = this.options.workerFactory ?? defaultWorkerFactory(this.options.workerUrl);
    const worker = factory();
    const listener = (event) => this.onMessage(event.data);
    if (typeof worker.addEventListener === "function") worker.addEventListener("message", listener);
    else worker.onmessage = listener;
    this.worker = worker;
    return worker;
  }
  onMessage(message) {
    switch (message.type) {
      case "prepared": {
        const pending = this.pendingPrepares.get(message.key);
        if (!pending) return;
        this.pendingPrepares.delete(message.key);
        const script = {
          language: this.language,
          inputs: message.inputs,
          meta: message.meta,
          reactsToViewport: message.reactsToViewport,
          token: { workerKey: message.key }
        };
        if (message.props) script.props = message.props;
        pending.resolve(script);
        break;
      }
      case "error": {
        if (message.key) {
          const pending = this.pendingPrepares.get(message.key);
          if (pending) {
            this.pendingPrepares.delete(message.key);
            const err = new Error(message.message);
            if (message.name) err.name = message.name;
            pending.reject(err);
            return;
          }
        }
        if (message.sessionId) {
          const record = this.sessions.get(message.sessionId);
          const err = new Error(message.message);
          if (message.name) err.name = message.name;
          record?.handlers.onError?.(err);
        }
        break;
      }
      case "model":
        this.sessions.get(message.sessionId)?.handlers.onModel(message.model);
        break;
      case "alert":
        this.sessions.get(message.sessionId)?.handlers.onAlert?.(message.alert);
        break;
      case "warning":
        this.sessions.get(message.sessionId)?.handlers.onWarning?.(message.warning);
        break;
      case "done":
        this.sessions.get(message.sessionId)?.handlers.onDone?.();
        break;
      case "context": {
        const record = this.sessions.get(message.sessionId);
        const resolve = record?.contexts.get(message.requestId);
        if (resolve) {
          record?.contexts.delete(message.requestId);
          resolve(message.snapshot);
        }
        break;
      }
      case "fetchSeriesRequest": {
        const record = [...this.sessions.values()].find((r) => r.request.fetchSeries);
        const fetchSeries = record?.request.fetchSeries;
        if (!fetchSeries) {
          this.send({ type: "fetchSeriesResult", requestId: message.requestId, bars: [], error: "no fetchSeries gateway" });
          return;
        }
        fetchSeries(message.symbol, message.timeframe, message.range).then((bars) => this.send({ type: "fetchSeriesResult", requestId: message.requestId, bars })).catch(
          (err) => this.send({ type: "fetchSeriesResult", requestId: message.requestId, bars: [], error: normalizeError(err).message })
        );
        break;
      }
      default:
        break;
    }
  }
  send(message) {
    if (this.disposed) return;
    this.ensureWorker().postMessage(message);
  }
  // ------------------------------------------------------------------ engine API
  async prepare(source, instanceId) {
    const key = `p${++this.keySeq}`;
    return new Promise((resolve, reject) => {
      this.pendingPrepares.set(key, { resolve, reject });
      try {
        this.send({ type: "prepare", key, source, instanceId });
      } catch (err) {
        this.pendingPrepares.delete(key);
        reject(normalizeError(err));
      }
    });
  }
  execute(req, handlers) {
    const token = req.prepared.token;
    if (!token || typeof token.workerKey !== "string") {
      throw new Error("execute() needs a script produced by this engine's prepare()");
    }
    const sessionId = `s${++this.sessionSeq}`;
    const record = {
      handlers,
      request: { ...req.fetchSeries ? { fetchSeries: req.fetchSeries } : {} },
      contexts: /* @__PURE__ */ new Map(),
      stopped: false
    };
    this.sessions.set(sessionId, record);
    this.send({
      type: "execute",
      key: token.workerKey,
      sessionId,
      request: {
        market: req.market,
        bars: req.getBars ? req.getBars() : req.bars,
        inputs: req.inputs ?? {},
        props: req.props ?? {},
        mode: req.mode,
        canFetch: Boolean(req.fetchSeries),
        ...req.historyState ? { historyState: req.historyState } : {},
        ...req.visibleRange ? { visibleRange: req.visibleRange } : {}
      }
    });
    return {
      getContext: (select) => new Promise((resolve) => {
        if (record.stopped) {
          resolve(null);
          return;
        }
        const requestId = `c${++this.contextSeq}`;
        record.contexts.set(requestId, resolve);
        this.send({ type: "context", sessionId, requestId, ...select ? { select } : {} });
        setTimeout(() => {
          if (record.contexts.delete(requestId)) resolve(null);
        }, 5e3).unref?.();
      }),
      stop: () => {
        record.stopped = true;
        this.send({ type: "stop", sessionId });
        for (const resolve of record.contexts.values()) resolve(null);
        record.contexts.clear();
        this.sessions.delete(sessionId);
      },
      update: (inputs, props) => {
        if (record.stopped) return;
        this.send({ type: "update", sessionId, inputs, ...props ? { props } : {} });
      },
      setVisibleRange: (_range) => {
      },
      notifyBars: (reason) => {
        if (record.stopped) return;
        this.send({ type: "notifyBars", sessionId, ...reason ? { reason } : {} });
      }
    };
  }
  /** Terminate the worker and reject anything in flight. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("PineWorkerEngine disposed");
    for (const pending of this.pendingPrepares.values()) pending.reject(error);
    this.pendingPrepares.clear();
    for (const record of this.sessions.values()) {
      record.stopped = true;
      for (const resolve of record.contexts.values()) resolve(null);
      record.handlers.onError?.(error);
    }
    this.sessions.clear();
    this.worker?.terminate?.();
    this.worker = null;
  }
};
function defaultWorkerFactory(workerUrl) {
  return () => {
    const url = workerUrl ?? new URL("./worker.js", import.meta.url);
    const worker = new Worker(url, { type: "module" });
    return worker;
  };
}

// src/worker/worker.ts
function createWorkerHandler(scope) {
  const engine = new PineEngine();
  const prepared = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const pendingFetches = /* @__PURE__ */ new Map();
  let disposed = false;
  const post = (message) => {
    if (!disposed) scope.postMessage(message);
  };
  const handle2 = (message) => {
    switch (message.type) {
      case "prepare": {
        engine.prepare(message.source, message.instanceId).then((script) => {
          prepared.set(message.key, script);
          const reply = {
            type: "prepared",
            key: message.key,
            inputs: script.inputs,
            meta: script.meta,
            reactsToViewport: script.reactsToViewport,
            warnings: []
          };
          if (script.props) reply.props = script.props;
          post(reply);
        }).catch((err) => {
          post({ type: "error", key: message.key, message: normalizeError(err).message, name: normalizeError(err).name });
        });
        break;
      }
      case "execute": {
        const script = prepared.get(message.key);
        if (!script) {
          post({ type: "error", sessionId: message.sessionId, message: "unknown prepared script" });
          return;
        }
        const handlers = {
          onModel: (model) => post({ type: "model", sessionId: message.sessionId, model }),
          onAlert: (alert) => post({ type: "alert", sessionId: message.sessionId, alert }),
          onWarning: (warning) => post({ type: "warning", sessionId: message.sessionId, warning }),
          onDone: () => post({ type: "done", sessionId: message.sessionId }),
          onError: (error) => post({ type: "error", sessionId: message.sessionId, message: error.message, name: error.name })
        };
        const request = {
          prepared: script,
          market: message.request.market,
          bars: message.request.bars,
          inputs: message.request.inputs,
          props: message.request.props,
          mode: message.request.mode,
          ...message.request.historyState ? { historyState: message.request.historyState } : {},
          ...message.request.visibleRange ? { visibleRange: message.request.visibleRange } : {},
          ...message.request.canFetch ? { fetchSeries: makeFetch(message.request.canFetch) } : {}
        };
        try {
          const session = engine.execute(request, handlers);
          sessions.set(message.sessionId, { session, handlers });
        } catch (err) {
          handlers.onError?.(normalizeError(err));
        }
        break;
      }
      case "update":
        sessions.get(message.sessionId)?.session.update(message.inputs, message.props);
        break;
      case "notifyBars":
        sessions.get(message.sessionId)?.session.notifyBars(message.reason);
        break;
      case "stop":
        sessions.get(message.sessionId)?.session.stop();
        break;
      case "context": {
        const entry = sessions.get(message.sessionId);
        if (!entry) {
          post({ type: "context", sessionId: message.sessionId, requestId: message.requestId, snapshot: null });
          return;
        }
        const getContext = entry.session.getContext;
        if (!getContext) {
          post({ type: "context", sessionId: message.sessionId, requestId: message.requestId, snapshot: null });
          return;
        }
        getContext.call(entry.session, message.select).then((snapshot) => post({ type: "context", sessionId: message.sessionId, requestId: message.requestId, snapshot })).catch(() => post({ type: "context", sessionId: message.sessionId, requestId: message.requestId, snapshot: null }));
        break;
      }
      case "fetchSeriesResult": {
        const pending = pendingFetches.get(message.requestId);
        if (!pending) return;
        pendingFetches.delete(message.requestId);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.bars);
        break;
      }
      case "dispose":
        dispose();
        break;
      default:
        break;
    }
  };
  function makeFetch(canFetch) {
    if (!canFetch) return void 0;
    let seq = 0;
    return (symbol, timeframe, range) => new Promise((resolve, reject) => {
      const requestId = `fetch-${++seq}`;
      pendingFetches.set(requestId, { resolve, reject });
      post({ type: "fetchSeriesRequest", requestId, symbol, timeframe, range });
    });
  }
  function dispose() {
    disposed = true;
    for (const entry of sessions.values()) entry.session.stop();
    sessions.clear();
    prepared.clear();
    for (const pending of pendingFetches.values()) pending.reject(new Error("worker disposed"));
    pendingFetches.clear();
  }
  return { handle: handle2, dispose };
}
function installWorker(scope) {
  const handler = createWorkerHandler(scope);
  const listener = (event) => handler.handle(event.data);
  if (typeof scope.addEventListener === "function") scope.addEventListener("message", listener);
  else scope.onmessage = listener;
  return handler;
}
var globalScope = globalThis;
if (typeof globalScope.postMessage === "function" && typeof globalScope.document === "undefined") {
  installWorker(globalScope);
}
export {
  Broker,
  COLOR_NAMES,
  DEFAULT_BROKER_OPTIONS,
  INDICATOR_PROP_SPECS,
  PineArray,
  PineColor,
  PineEngine,
  PineRuntimeError,
  PineSyntaxError,
  PineWorkerEngine,
  Runtime,
  STRATEGY_PROP_SPECS,
  analyze,
  assertSupportedVersion,
  builtinNames,
  createWorkerHandler,
  detectVersion,
  installWorker,
  normalizeError,
  parseScript,
  resetCallIds,
  tokenize
};
//# sourceMappingURL=index.js.map