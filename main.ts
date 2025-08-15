import { readFile } from "node:fs/promises";
import {
  parse,
  type ImportDeclaration,
  type Program,
  type Node,
  type ImportSpecifier,
  type Identifier,
} from "acorn";
import MagicString from "magic-string";

export type Options = {
  /**
   * Chunks are telling what modules should be produced
   * with which entry.
   */
  chunks: Record<string, string>;
  /**
   * This is parent (caller) URL that is used
   * to resolve modules relative paths.
   */
  parent: URL;
};

/**
 * Has single module definition with it's AST in form of `Program` object from `acorn`.
 * Exposing some module data e.g. module dependencies.
 * AST <preferably> should not be leaked.
 */
class Module {
  public resolvedPath?: URL;
  private source?: string;
  private program?: Program;
  constructor(
    private readonly input: string,
    private readonly parentUrl: URL
  ) {}
  public async init() {
    this.resolve();
    await this.load();
    this.parse();
  }
  public calculateDependencyPaths(): string[] {
    return this.calculateImportDeclarations()
      .map((importDeclaration) => importDeclaration.source.value)
      .filter((value) => typeof value === "string");
  }
  public calculateNotUsedImportDeclarations() {
    const importSpecifiersMap = this.calculateImportSpecifiersMap();
    const usedSpecifiers = this.calculateUsedSpecifiersInModuleBody();
    const notUsedSpecifiers: ImportDeclaration[] = [];
    for (const [importDeclaration, importSpecifiers] of importSpecifiersMap) {
      const anyUsed = importSpecifiers.some((importSpecifier) =>
        usedSpecifiers.some(
          (usedSpecifier) =>
            this.nodeToPlain(usedSpecifier) ===
            this.nodeToPlain(importSpecifier)
        )
      );
      if (!anyUsed) {
        notUsedSpecifiers.push(importDeclaration);
      }
    }
    return notUsedSpecifiers;
  }
  public getCode({ withRemovedNodes }: { withRemovedNodes: Node[] }) {
    const str = new MagicString(this.source);
    if (withRemovedNodes && withRemovedNodes.length) {
      this.removeNodes(str, withRemovedNodes);
    }
    return str.toString();
  }
  private removeNodes(source: MagicString, nodes: Node[]) {
    return nodes.reduce((code: MagicString, nodeToRemove: Node) => {
      return code.remove(nodeToRemove.start, nodeToRemove.end);
    }, source);
  }
  private calculateImportDeclarations() {
    const importDeclarations: ImportDeclaration[] = [];
    for (const node of this.program.body) {
      if (node.type === "ImportDeclaration") {
        importDeclarations.push(node);
      }
    }
    return importDeclarations;
  }
  private calculateImportSpecifiersMap() {
    const importSpecifiersMap = new Map<
      ImportDeclaration,
      Array<ImportSpecifier>
    >();
    for (const importDeclaration of this.calculateImportDeclarations()) {
      const importSpecifiers: ImportSpecifier[] = [];
      importSpecifiersMap.set(importDeclaration, importSpecifiers);
      for (const importSpecifier of importDeclaration.specifiers) {
        // TODO: handle also other types of imports
        if (importSpecifier.type === "ImportSpecifier") {
          if (importSpecifier.imported.type === "Identifier") {
            importSpecifiers.push(importSpecifier);
          }
        }
      }
    }
    return importSpecifiersMap;
  }
  private calculateUsedSpecifiersInModuleBody() {
    const usedSpecifiers: Identifier[] = [];
    for (const node of this.program.body) {
      // TODO: support other types of nodes
      if (node.type === "ExpressionStatement") {
        const expression = node.expression;
        if (expression.type === "CallExpression") {
          if (expression.callee.type === "Identifier") {
            usedSpecifiers.push(expression.callee);
          }
        }
      }
    }
    return usedSpecifiers;
  }
  private resolve() {
    this.resolvedPath = new URL(this.input, this.parentUrl);
  }
  private async load() {
    const buffer = await readFile(this.resolvedPath);
    this.source = String(buffer);
  }
  private parse() {
    this.program = parse(this.source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  }
  private nodeToPlain(node: Node) {
    return this.source.slice(node.start, node.end);
  }
}

/**
 * Build graph of modules for given entry path.
 */
class Graph {
  private readonly modules = new Map<URL, Module>();
  constructor(private readonly source: string, private readonly parent: URL) {}
  public async build() {
    await this.initModuleRecursively(this.source, this.parent);
  }
  public removeUnusedImports() {
    // TODO: implement passes and max depth of optimizations
    //       instead of iterating through all modules
    const modulesWithNoUnusedImports = new Map<Module, string>();
    for (const module of this.modules.values()) {
      const notUsedDeclarations = module.calculateNotUsedImportDeclarations();
      const modifiedCode = module.getCode({
        withRemovedNodes: notUsedDeclarations,
      });
      modulesWithNoUnusedImports.set(module, modifiedCode);
    }

    return modulesWithNoUnusedImports;
  }
  private async initModuleRecursively(path: string, parent: URL) {
    const module = await this.initModule(path, parent);
    const moduleDependencyPaths = module.calculateDependencyPaths();
    await Promise.all(
      moduleDependencyPaths.map(async (moduleDependencyPath) => {
        await this.initModuleRecursively(
          moduleDependencyPath,
          module.resolvedPath
        );
      })
    );
  }
  private async initModule(path: string, parent: URL) {
    const module = new Module(path, parent);
    await module.init();
    this.modules.set(module.resolvedPath, module);
    return module;
  }
}

/**
 * Chunk represents final chunk that is produced after all transformations.
 * It's responsibility is to contain logic related to transformation of `Graph`
 * into final chunk.
 */
class Chunk {
  private readonly graph: Graph;
  public async build(): Promise<void> {
    await this.graph.build();
  }
  public generate() {
    const withRemovedImports = this.graph.removeUnusedImports();
    // TODO: this should return all modules concatenated
    const [[, code]] = withRemovedImports;
    return code;
  }
  constructor(
    private readonly source: string,
    private readonly destination: string,
    private readonly parent: URL
  ) {
    this.graph = new Graph(this.source, this.parent);
  }
}

/**
 * Public API of tree shaker.
 */
export const treeShaker = async (options: Options) => {
  const chunks: Chunk[] = [];
  await Promise.all(
    Object.entries(options.chunks).map(
      async ([chunkDestination, chunkSource]) => {
        const chunk = new Chunk(chunkSource, chunkDestination, options.parent);
        chunks.push(chunk);
        await chunk.build();
      }
    )
  );
  return {
    generate() {
      return chunks.map((chunk) => chunk.generate());
    },
  };
};
