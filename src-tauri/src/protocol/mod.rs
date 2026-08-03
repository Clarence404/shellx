use serde::{Deserialize, Serialize};

pub mod ssh;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub username: String,
    pub method: AuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AuthMethod {
    Password(String),
}
