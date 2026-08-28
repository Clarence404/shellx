//! FTP and FTPS: the client, and the two things about FTP that make it
//! harder than it looks — filename encoding and listing formats.

pub mod charset;
pub mod client;
pub mod listing;
pub mod manager;
