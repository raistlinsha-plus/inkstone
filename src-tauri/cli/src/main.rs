use inkstone_lib::external_access::{self, AccessError};
use serde_json::{json, Value};
use std::{env, path::PathBuf, process::ExitCode};

const USAGE: &str = "Inkstone CLI · source preview\n\ninkstone-cli search --space SPACE_ID --query QUESTION --json\ninkstone-cli read --space SPACE_ID --ref REFERENCE --json\n\nSet INKSTONE_CLI_TOKEN with a space credential created in Inkstone Settings → External tools. Output is JSON v1. Commands read existing local indexes and document excerpts.";

fn data_dir() -> Result<PathBuf, AccessError> {
    #[cfg(feature = "isolated-fixture")]
    return env::var_os("INKSTONE_CLI_FIXTURE_DIR")
        .map(PathBuf::from)
        .ok_or(AccessError::StorageUnavailable);
    #[cfg(not(feature = "isolated-fixture"))]
    dirs::data_dir()
        .map(|root| root.join("local.inkstone.desktop"))
        .ok_or(AccessError::StorageUnavailable)
}

fn execute(args: &[String]) -> Result<Value, AccessError> {
    let Some((op, flags)) = args.split_first() else {
        return Err(AccessError::BadRequest);
    };
    let key = match op.as_str() {
        "search" => "--query",
        "read" => "--ref",
        _ => return Err(AccessError::BadRequest),
    };
    let (mut space, mut value) = (None, None);
    let mut iter = flags.iter();
    while let Some(flag) = iter.next() {
        match flag.as_str() {
            "--json" => (),
            "--space" if space.is_none() => {
                space = Some(iter.next().ok_or(AccessError::BadRequest)?)
            }
            v if v == key && value.is_none() => {
                value = Some(iter.next().ok_or(AccessError::BadRequest)?)
            }
            _ => return Err(AccessError::BadRequest),
        }
    }
    let (space, value) = (
        space.ok_or(AccessError::BadRequest)?,
        value.ok_or(AccessError::BadRequest)?,
    );
    let token = env::var("INKSTONE_CLI_TOKEN").map_err(|_| AccessError::Denied)?;
    let data = data_dir()?;
    let result = match op.as_str() {
        "search" => json!(external_access::search(&data, space, &token, value)?),
        _ => json!(external_access::read(&data, space, &token, value)?),
    };
    Ok(json!({"protocolVersion":1,"space":space,"result":result}))
}

fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.as_slice() == ["--help"] || args.as_slice() == ["-h"] {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    if args.as_slice() == ["--version"] {
        println!("inkstone-cli {} (protocol 1)", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    match execute(&args) {
        Ok(result) => {
            println!("{result}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}", json!({"protocolVersion":1,"error":e}));
            ExitCode::from(1)
        }
    }
}
