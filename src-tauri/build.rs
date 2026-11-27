fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        let obj = out.join("media.o");
        assert!(std::process::Command::new("clang")
            .args([
                "-arch",
                arch,
                "-mmacosx-version-min=13.0",
                "-fobjc-arc",
                "-c",
                "native/media.m",
                "-o"
            ])
            .arg(&obj)
            .status()
            .unwrap()
            .success());
        assert!(std::process::Command::new("ar")
            .arg("rcs")
            .arg(out.join("libinkmedia.a"))
            .arg(obj)
            .status()
            .unwrap()
            .success());
        println!("cargo:rerun-if-changed=native/media.m");
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=inkmedia");
        for framework in ["Foundation", "Vision", "ImageIO", "CoreGraphics", "CoreML"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
