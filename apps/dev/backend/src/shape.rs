//! The shape of a JSON document, told from a sample of it: what kind each value is, which keys objects have, what
//! arrays hold. A schema and type declarations are both written from it.
//!
//! The items of an array are taken as samples of one thing: their shapes are
//! merged into one. A key that some of the objects lack is not required; a
//! place that holds values of several kinds is a choice between them.

use crate::tree::{unquoted, Node};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Shape {
    Null,
    Bool,
    /// A number written without a fraction or an exponent.
    Integer,
    Number,
    Text,
    /// What the items are; none for an array that was always empty.
    Array(Option<Box<Shape>>),
    /// The members in the order they were first met.
    Object(Vec<Member>),
    /// One of several, none of them a choice itself, each of another kind.
    OneOf(Vec<Shape>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub key: String,
    pub shape: Shape,
    /// Every object that was met had this key.
    pub required: bool,
}

/// The shape of a value. Call inside [`crate::tree::deep`].
pub fn of(node: &Node) -> Shape {
    match node {
        Node::Scalar(text) => match &**text {
            "null" => Shape::Null,
            "true" | "false" => Shape::Bool,
            written if written.starts_with('"') => Shape::Text,
            written if written.contains(['.', 'e', 'E']) => Shape::Number,
            _ => Shape::Integer,
        },
        Node::Array(items) => Shape::Array(items.iter().map(of).reduce(merge).map(Box::new)),
        Node::Object(members) => {
            let mut known: Vec<Member> = Vec::with_capacity(members.len());
            for (key, value) in members {
                let key = unquoted(key);
                let shape = of(value);
                // A key written twice: the two values are samples of the same member.
                match known.iter_mut().find(|member| member.key == key) {
                    Some(member) => member.shape = merge(std::mem::replace(&mut member.shape, Shape::Null), shape),
                    None => known.push(Member { key, shape, required: true }),
                }
            }
            Shape::Object(known)
        }
    }
}

/// Two kinds are the same kind (whatever is inside them).
fn alike(first: &Shape, second: &Shape) -> bool {
    matches!((first, second), (Shape::Integer | Shape::Number, Shape::Integer | Shape::Number)) || std::mem::discriminant(first) == std::mem::discriminant(second)
}

/// One shape that both samples fit.
pub fn merge(first: Shape, second: Shape) -> Shape {
    match (first, second) {
        (Shape::OneOf(mut choices), other) | (other, Shape::OneOf(mut choices)) => {
            let others = match other {
                Shape::OneOf(others) => others,
                other => vec![other],
            };
            for other in others {
                match choices.iter().position(|choice| alike(choice, &other)) {
                    Some(at) => {
                        let merged = merge(std::mem::replace(&mut choices[at], Shape::Null), other);
                        choices[at] = merged;
                    }
                    None => choices.push(other),
                }
            }
            Shape::OneOf(choices)
        }
        (Shape::Integer, Shape::Integer) => Shape::Integer,
        (Shape::Integer | Shape::Number, Shape::Integer | Shape::Number) => Shape::Number,
        (Shape::Array(first), Shape::Array(second)) => Shape::Array(match (first, second) {
            (Some(first), Some(second)) => Some(Box::new(merge(*first, *second))),
            (one, other) => one.or(other),
        }),
        (Shape::Object(mut first), Shape::Object(second)) => {
            // A key only one of them has is not required; the others are, as far as both said so.
            for member in &mut first {
                member.required &= second.iter().any(|other| other.key == member.key && other.required);
            }
            for other in second {
                match first.iter_mut().find(|member| member.key == other.key) {
                    Some(member) => member.shape = merge(std::mem::replace(&mut member.shape, Shape::Null), other.shape),
                    None => first.push(Member { required: false, ..other }),
                }
            }
            Shape::Object(first)
        }
        (first, second) if first == second => first,
        (first, second) => Shape::OneOf(vec![first, second]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::Style;

    pub fn shape(text: &str) -> Shape {
        let (minified, _) = crate::json::transform_text(text, Style::Minify, &mut |_| true).expect("JSON");
        of(&crate::tree::build(&minified).expect("a tree"))
    }

    fn member(key: &str, shape: Shape, required: bool) -> Member {
        Member { key: key.into(), shape, required }
    }

    #[test]
    fn scalars_are_told_apart() {
        assert_eq!(shape("null"), Shape::Null);
        assert_eq!(shape("true"), Shape::Bool);
        assert_eq!(shape("12"), Shape::Integer);
        assert_eq!(shape("-1.0"), Shape::Number);
        assert_eq!(shape("1e3"), Shape::Number);
        assert_eq!(shape("\"1\""), Shape::Text);
        assert_eq!(shape("[]"), Shape::Array(None));
    }

    #[test]
    fn the_items_of_an_array_are_samples_of_one_thing() {
        assert_eq!(shape("[1, 2.5]"), Shape::Array(Some(Box::new(Shape::Number))));
        assert_eq!(shape("[1, \"a\", null, 2]"), Shape::Array(Some(Box::new(Shape::OneOf(vec![Shape::Integer, Shape::Text, Shape::Null])))));
        assert_eq!(
            shape(r#"[{"id": 1, "tags": []}, {"id": 2.5, "name": "x", "tags": ["a"]}]"#),
            Shape::Array(Some(Box::new(Shape::Object(vec![member("id", Shape::Number, true), member("tags", Shape::Array(Some(Box::new(Shape::Text))), true), member("name", Shape::Text, false)]))))
        );
        // Objects among other kinds are still merged with each other.
        assert_eq!(shape(r#"[{"a": 1}, "x", {"b": 2}]"#), Shape::Array(Some(Box::new(Shape::OneOf(vec![Shape::Object(vec![member("a", Shape::Integer, false), member("b", Shape::Integer, false)]), Shape::Text])))));
    }
}
