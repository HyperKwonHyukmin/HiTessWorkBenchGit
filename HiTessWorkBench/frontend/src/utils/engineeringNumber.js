/**
 * 엔지니어링 입력용 사칙연산 파서.
 * eval/Function을 사용하지 않고 숫자, 괄호, + - * / ^만 허용한다.
 */
export function parseEngineeringExpression(expression) {
  const source = String(expression ?? '').replace(/\s+/g, '');
  if (!source) return null;

  let index = 0;

  const peek = () => source[index];
  const consume = () => source[index++];

  const parseNumber = () => {
    const start = index;
    let sawDigit = false;

    while (/\d/.test(peek() || '')) {
      sawDigit = true;
      consume();
    }
    if (peek() === '.') {
      consume();
      while (/\d/.test(peek() || '')) {
        sawDigit = true;
        consume();
      }
    }
    if (!sawDigit) throw new Error('number expected');

    if ((peek() || '').toLowerCase() === 'e') {
      consume();
      if (peek() === '+' || peek() === '-') consume();
      const exponentStart = index;
      while (/\d/.test(peek() || '')) consume();
      if (index === exponentStart) throw new Error('invalid exponent');
    }

    const value = Number(source.slice(start, index));
    if (!Number.isFinite(value)) throw new Error('non-finite value');
    return value;
  };

  const parsePrimary = () => {
    if (peek() === '+') {
      consume();
      return parsePrimary();
    }
    if (peek() === '-') {
      consume();
      return -parsePrimary();
    }
    if (peek() === '(') {
      consume();
      const value = parseExpression();
      if (consume() !== ')') throw new Error('closing parenthesis expected');
      return value;
    }
    return parseNumber();
  };

  const parsePower = () => {
    const base = parsePrimary();
    if (peek() === '^') {
      consume();
      return base ** parsePower();
    }
    return base;
  };

  const parseTerm = () => {
    let value = parsePower();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const right = parsePower();
      if (operator === '/' && right === 0) throw new Error('division by zero');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };

  const parseExpression = () => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  try {
    const value = parseExpression();
    if (index !== source.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}
