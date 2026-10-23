//! The formulas of a user's own units.
//!
//! A unit of the user's own can say how it becomes another unit with a
//! formula in `x`, and how it comes back with a second one: `x * 9 / 5 + 32`.
//! A formula is read into a small tree here and worked out from the tree. It
//! is never handed to anything that runs code: what is not arithmetic, `x`, a
//! known constant or a known function is refused.

/// The longest formula read.
const LONGEST: usize = 400;
/// How deep brackets and functions may nest.
const DEEPEST: usize = 48;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Function {
    Sqrt,
    Abs,
    Ln,
    Log,
    Log2,
    Exp,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
}

const FUNCTIONS: &[(&str, Function)] = &[
    ("sqrt", Function::Sqrt),
    ("abs", Function::Abs),
    ("ln", Function::Ln),
    ("log10", Function::Log),
    ("log2", Function::Log2),
    ("log", Function::Log),
    ("exp", Function::Exp),
    ("asin", Function::Asin),
    ("acos", Function::Acos),
    ("atan", Function::Atan),
    ("sin", Function::Sin),
    ("cos", Function::Cos),
    ("tan", Function::Tan),
];

/// A formula, read.
#[derive(Debug, Clone, PartialEq)]
pub enum Formula {
    Number(f64),
    /// The value the formula is asked for.
    X,
    Minus(Box<Formula>),
    Two(Op, Box<Formula>, Box<Formula>),
    Call(Function, Box<Formula>),
}

/// Why a formula was refused, and where in it (a letter counted from 0).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FormulaError {
    pub at: usize,
    /// A stable word for the interface to translate: `empty`, `too-long`, `too-deep`, `number`, `name`, `bracket`, `expected`, `left-over`.
    pub what: &'static str,
}

struct Reader<'a> {
    letters: &'a [char],
    at: usize,
    depth: usize,
}

impl Reader<'_> {
    fn error<T>(&self, what: &'static str) -> Result<T, FormulaError> {
        Err(FormulaError { at: self.at, what })
    }

    fn skip(&mut self) {
        while self.letters.get(self.at).is_some_and(|letter| letter.is_whitespace()) {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.skip();
        self.letters.get(self.at).copied()
    }

    fn take(&mut self, wanted: &[char]) -> Option<char> {
        let found = self.peek().filter(|letter| wanted.contains(letter))?;
        self.at += 1;
        Some(found)
    }

    fn sum(&mut self) -> Result<Formula, FormulaError> {
        let mut left = self.product()?;
        while let Some(sign) = self.take(&['+', '-', '−']) {
            let right = self.product()?;
            left = Formula::Two(if sign == '+' { Op::Add } else { Op::Sub }, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn product(&mut self) -> Result<Formula, FormulaError> {
        let mut left = self.signed()?;
        while let Some(sign) = self.take(&['*', '/', '×', '·', '÷']) {
            let right = self.signed()?;
            left = Formula::Two(if matches!(sign, '/' | '÷') { Op::Div } else { Op::Mul }, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn signed(&mut self) -> Result<Formula, FormulaError> {
        if self.take(&['-', '−']).is_some() {
            return Ok(Formula::Minus(Box::new(self.signed()?)));
        }
        if self.take(&['+']).is_some() {
            return self.signed();
        }
        self.power()
    }

    fn power(&mut self) -> Result<Formula, FormulaError> {
        let base = self.atom()?;
        if self.take(&['^']).is_some() {
            // To the right first: 2^3^2 is 2^9; and a minus may stand in the power.
            let power = self.signed()?;
            return Ok(Formula::Two(Op::Pow, Box::new(base), Box::new(power)));
        }
        Ok(base)
    }

    fn bracketed(&mut self) -> Result<Formula, FormulaError> {
        self.depth += 1;
        if self.depth > DEEPEST {
            return self.error("too-deep");
        }
        let inside = self.sum()?;
        if self.take(&[')']).is_none() {
            return self.error("bracket");
        }
        self.depth -= 1;
        Ok(inside)
    }

    fn atom(&mut self) -> Result<Formula, FormulaError> {
        let Some(letter) = self.peek() else { return self.error("expected") };
        if letter == '(' {
            self.at += 1;
            return self.bracketed();
        }
        if letter.is_ascii_digit() || letter == '.' {
            let from = self.at;
            while self.letters.get(self.at).is_some_and(|letter| letter.is_ascii_digit() || *letter == '.') {
                self.at += 1;
            }
            // A power of ten: an `e` with digits after it. An `e` alone is the constant, met as a name.
            if matches!(self.letters.get(self.at), Some('e' | 'E')) {
                let sign = usize::from(matches!(self.letters.get(self.at + 1), Some('+' | '-')));
                if self.letters.get(self.at + 1 + sign).is_some_and(char::is_ascii_digit) {
                    self.at += 1 + sign;
                    while self.letters.get(self.at).is_some_and(char::is_ascii_digit) {
                        self.at += 1;
                    }
                }
            }
            let written: String = self.letters[from..self.at].iter().collect();
            return match written.parse::<f64>() {
                Ok(value) if value.is_finite() => Ok(Formula::Number(value)),
                _ => {
                    self.at = from;
                    self.error("number")
                }
            };
        }
        if letter.is_alphabetic() || letter == 'π' {
            let from = self.at;
            while self.letters.get(self.at).is_some_and(|letter| letter.is_alphanumeric() || *letter == 'π') {
                self.at += 1;
            }
            let name: String = self.letters[from..self.at].iter().collect::<String>().to_lowercase();
            if let Some((_, function)) = FUNCTIONS.iter().find(|(known, _)| *known == name) {
                if self.take(&['(']).is_none() {
                    return self.error("bracket");
                }
                return Ok(Formula::Call(*function, Box::new(self.bracketed()?)));
            }
            return match name.as_str() {
                "x" | "value" => Ok(Formula::X),
                "pi" | "π" => Ok(Formula::Number(std::f64::consts::PI)),
                "e" => Ok(Formula::Number(std::f64::consts::E)),
                _ => {
                    self.at = from;
                    self.error("name")
                }
            };
        }
        self.error("expected")
    }
}

/// Reads a formula.
pub fn read(written: &str) -> Result<Formula, FormulaError> {
    let letters: Vec<char> = written.chars().collect();
    if written.trim().is_empty() {
        return Err(FormulaError { at: 0, what: "empty" });
    }
    if letters.len() > LONGEST {
        return Err(FormulaError { at: LONGEST, what: "too-long" });
    }
    let mut reader = Reader { letters: &letters, at: 0, depth: 0 };
    let formula = reader.sum()?;
    if reader.peek().is_some() {
        return reader.error("left-over");
    }
    Ok(formula)
}

impl Formula {
    /// What the formula comes to for `x`. None where it comes to nothing: a division by zero, the root of a negative number.
    pub fn value(&self, x: f64) -> Option<f64> {
        let value = match self {
            Formula::Number(number) => *number,
            Formula::X => x,
            Formula::Minus(inside) => -inside.value(x)?,
            Formula::Two(op, left, right) => {
                let (left, right) = (left.value(x)?, right.value(x)?);
                match op {
                    Op::Add => left + right,
                    Op::Sub => left - right,
                    Op::Mul => left * right,
                    Op::Div => left / right,
                    Op::Pow => left.powf(right),
                }
            }
            Formula::Call(function, inside) => {
                let inside = inside.value(x)?;
                match function {
                    Function::Sqrt => inside.sqrt(),
                    Function::Abs => inside.abs(),
                    Function::Ln => inside.ln(),
                    Function::Log => inside.log10(),
                    Function::Log2 => inside.log2(),
                    Function::Exp => inside.exp(),
                    Function::Sin => inside.sin(),
                    Function::Cos => inside.cos(),
                    Function::Tan => inside.tan(),
                    Function::Asin => inside.asin(),
                    Function::Acos => inside.acos(),
                    Function::Atan => inside.atan(),
                }
            }
        };
        value.is_finite().then_some(value)
    }

    /// Whether the formula looks at the value it is asked for: one that does not is no conversion.
    pub fn uses_x(&self) -> bool {
        match self {
            Formula::Number(_) => false,
            Formula::X => true,
            Formula::Minus(inside) | Formula::Call(_, inside) => inside.uses_x(),
            Formula::Two(_, left, right) => left.uses_x() || right.uses_x(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worked(written: &str, x: f64) -> String {
        match read(written) {
            Ok(formula) => formula.value(x).map_or_else(|| "-".to_owned(), |value| format!("{value:.4}")),
            Err(error) => format!("{} at {}", error.what, error.at),
        }
    }

    #[test]
    fn works_out_arithmetic_in_its_order() {
        assert_eq!(worked("x * 9 / 5 + 32", 100.0), "212.0000");
        assert_eq!(worked("(x - 32) × 5 ÷ 9", 212.0), "100.0000");
        assert_eq!(worked("2 + 3 * 4 ^ 2", 0.0), "50.0000");
        assert_eq!(worked("2^3^2", 0.0), "512.0000");
        assert_eq!(worked("-x^2", 3.0), "-9.0000");
        assert_eq!(worked("2^-1", 0.0), "0.5000");
        assert_eq!(worked("1.5e3 + x", 1.0), "1501.0000");
        assert_eq!(worked("2 * e", 0.0), "5.4366");
        assert_eq!(worked("VALUE / 2", 3.0), "1.5000");
    }

    #[test]
    fn knows_its_functions_and_constants() {
        assert_eq!(worked("20 * log10(x / 0.00002)", 1.0), "93.9794");
        assert_eq!(worked("sqrt(x) + abs(-2) + ln(e) + log2(8)", 16.0), "10.0000");
        assert_eq!(worked("atan(x / 100) * 180 / pi", 100.0), "45.0000");
        assert_eq!(worked("sin(π / 2) + cos(0) + exp(0)", 0.0), "3.0000");
    }

    #[test]
    fn comes_to_nothing_where_there_is_no_value() {
        assert_eq!(worked("1 / x", 0.0), "-");
        assert_eq!(worked("sqrt(x)", -1.0), "-");
        assert_eq!(worked("ln(x)", 0.0), "-");
    }

    #[test]
    fn refuses_what_is_not_a_formula() {
        assert_eq!(worked("", 0.0), "empty at 0");
        assert_eq!(worked("x +", 0.0), "expected at 3");
        assert_eq!(worked("(x + 1", 0.0), "bracket at 6");
        assert_eq!(worked("x 2", 0.0), "left-over at 2");
        assert_eq!(worked("alert(1)", 0.0), "name at 0");
        assert_eq!(worked("y * 2", 0.0), "name at 0");
        assert_eq!(worked("sqrt x", 0.0), "bracket at 5");
        assert_eq!(worked("1.2.3", 0.0), "number at 0");
        assert_eq!(worked(&"(".repeat(60), 0.0), "too-deep at 49");
        assert!(read("x * 2").expect("a formula").uses_x());
        assert!(!read("2 * pi").expect("a formula").uses_x());
    }
}
