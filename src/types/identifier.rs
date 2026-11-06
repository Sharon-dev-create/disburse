use core::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentifierError {
    Empty,
}

impl fmt::Display for IdentifierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("identifier cannot be empty or whitespace-only"),
        }
    }
}

impl std::error::Error for IdentifierError {}

pub(crate) fn validate_identifier(value: &str) -> Result<(), IdentifierError> {
    if value.trim().is_empty() {
        Err(IdentifierError::Empty)
    } else {
        Ok(())
    }
}
