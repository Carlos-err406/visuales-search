use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::{error::Error, fs};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("Usage: verify-update <public-key-file> <artifact> <signature-file>".into());
    }
    let decode = |value: String| -> Result<String, Box<dyn Error>> {
        Ok(String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(value.trim())?,
        )?)
    };
    let key = PublicKey::decode(&decode(fs::read_to_string(&args[0])?)?)?;
    let signature = Signature::decode(&decode(fs::read_to_string(&args[2])?)?)?;
    key.verify(&fs::read(&args[1])?, &signature, true)?;
    println!("Updater signature matches the app's trusted public key");
    Ok(())
}
