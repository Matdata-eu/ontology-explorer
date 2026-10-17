//! ontology-explorer: build an indexed bundle from ontology, SKOS and SHACL
//! files, print statistics, or open the viewer on them.

mod inputs;
mod serve;

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use ontology_explorer_core::{Options, build_bundle};
use std::path::PathBuf;

const ISSUES: &str = "https://github.com/Matdata-eu/ontology-explorer/issues";

#[derive(Parser)]
#[command(
    name = "ontology-explorer",
    version,
    about = "Visual explorer for ontologies, SKOS concept schemes and SHACL shapes",
    long_about = "Reads OWL/RDFS ontologies, SKOS concept schemes and SHACL shapes (Turtle, N-Triples, TriG, N-Quads, RDF/XML, JSON-LD; files or URLs) and shows them as UML-like diagrams, trees and readable pages in a web viewer. `build` writes the pre-indexed bundle the static viewer loads (for GitHub Pages), `serve` opens the viewer on the files directly.",
    after_help = format!("Questions, bugs and feature requests: {ISSUES}")
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write the pre-indexed bundle (JSON) that the viewer loads
    Build(BuildArgs),
    /// Print what the inputs contain
    Stats(InputArgs),
    /// Open the viewer on the inputs in a local web server
    Serve(serve::ServeArgs),
}

#[derive(Args, Clone)]
pub struct InputArgs {
    /// Ontology, SKOS and SHACL files or URLs (any order, any mix; .gz accepted)
    #[arg(required = true, value_name = "FILE|URL")]
    pub inputs: Vec<String>,
    /// Title shown in the viewer (default: the ontology's own title)
    #[arg(long)]
    pub title: Option<String>,
    /// Keep at most this many instances per class
    #[arg(long, default_value_t = 200, value_name = "N")]
    pub max_individuals: usize,
}

#[derive(Args)]
struct BuildArgs {
    #[command(flatten)]
    input: InputArgs,
    /// Output file (bundle.json) or directory
    #[arg(short, long, default_value = "bundle.json", value_name = "PATH")]
    output: PathBuf,
    /// Also write a gzip-compressed copy next to it (bundle.json.gz)
    #[arg(long)]
    gzip: bool,
    /// Indent the JSON (bigger, easier to read)
    #[arg(long)]
    pretty: bool,
}

fn options(input: &InputArgs) -> Options {
    Options {
        title: input.title.clone(),
        generator: format!("ontology-explorer {}", env!("CARGO_PKG_VERSION")),
        max_individuals_per_class: input.max_individuals,
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build(args) => build(args),
        Command::Stats(args) => stats(args),
        Command::Serve(args) => serve::run(args),
    }
}

fn build(args: BuildArgs) -> Result<()> {
    let started = std::time::Instant::now();
    let sources = inputs::read_all(&args.input.inputs)?;
    let bundle = build_bundle(&sources, &options(&args.input))?;
    let json = if args.pretty {
        serde_json::to_string_pretty(&bundle)?
    } else {
        serde_json::to_string(&bundle)?
    };
    let path = if args.output.is_dir()
        || args.output.extension().is_none()
            && !args.output.exists()
            && args.output.to_string_lossy().ends_with('/')
    {
        std::fs::create_dir_all(&args.output)?;
        args.output.join("bundle.json")
    } else if args.output.is_dir() {
        args.output.join("bundle.json")
    } else {
        if let Some(parent) = args.output.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        args.output.clone()
    };
    std::fs::write(&path, &json).with_context(|| format!("cannot write {}", path.display()))?;
    eprintln!(
        "wrote {} ({} KB, {} entities, {} triples) in {:.1}s",
        path.display(),
        json.len() / 1024,
        bundle.entities.len(),
        bundle.stats.triples,
        started.elapsed().as_secs_f64()
    );
    if args.gzip {
        use std::io::Write;
        let gz_path = PathBuf::from(format!("{}.gz", path.display()));
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        enc.write_all(json.as_bytes())?;
        let data = enc.finish()?;
        std::fs::write(&gz_path, &data)?;
        eprintln!("wrote {} ({} KB)", gz_path.display(), data.len() / 1024);
    }
    Ok(())
}

fn stats(args: InputArgs) -> Result<()> {
    let started = std::time::Instant::now();
    let sources = inputs::read_all(&args.inputs)?;
    let bundle = build_bundle(&sources, &options(&args))?;
    let s = &bundle.stats;
    println!("{}", bundle.title.as_deref().unwrap_or("(untitled)"));
    for src in &bundle.sources {
        println!("  {:>8} triples  {}", src.triples, src.name);
    }
    println!();
    let row = |name: &str, n: usize| {
        if n > 0 {
            println!("  {n:>8}  {name}");
        }
    };
    row("classes", s.classes);
    row("object properties", s.object_properties);
    row("datatype properties", s.datatype_properties);
    row("annotation properties", s.annotation_properties);
    row("other properties", s.other_properties);
    row("datatypes", s.datatypes);
    row("concept schemes", s.concept_schemes);
    row("concepts", s.concepts);
    row("node shapes", s.node_shapes);
    row("property shapes", s.property_shapes);
    row("individuals", s.individuals);
    println!();
    println!(
        "  languages: {}",
        if bundle.languages.is_empty() {
            "-".to_string()
        } else {
            bundle
                .languages
                .iter()
                .map(|l| if l.is_empty() { "(none)" } else { l.as_str() })
                .collect::<Vec<_>>()
                .join(", ")
        }
    );
    println!(
        "  SHACL: {}  DASH: {}  SKOS: {}",
        yes(s.uses_shacl),
        yes(s.uses_dash),
        yes(s.uses_skos)
    );
    if let Some(id) = bundle.suggested {
        println!("  suggested start: {}", bundle.entities[id as usize].curie);
    }
    println!("  built in {:.2}s", started.elapsed().as_secs_f64());
    Ok(())
}

fn yes(b: bool) -> &'static str {
    if b { "yes" } else { "no" }
}
