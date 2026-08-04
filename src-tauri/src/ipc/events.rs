use crate::session::SessionId;
use serde::Serialize;

pub const EV_DATA: &str = "session:data";
pub const EV_CLOSED: &str = "connection:closed";

#[derive(Serialize, Clone)]
pub struct DataEvent {
    pub id: SessionId,
    pub data: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct ClosedEvent {
    pub id: SessionId,
    pub reason: String,
}
