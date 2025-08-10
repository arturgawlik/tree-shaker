import { readFile } from "node:fs/promises";
import {
  type ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  parse,
  type Program,
} from "acorn";

export type Options = {
  input: string;
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
    const notUsedSpecifiers = [];
    for (const [importDeclaration, importSpecifiers] of importSpecifiersMap) {
      const anyUsed = importSpecifiers.some((importSpecifier) =>
        usedSpecifiers.includes(importSpecifier)
      );
      if (!anyUsed) {
        notUsedSpecifiers.push(importDeclaration);
      }
    }
    return notUsedSpecifiers;
  }
  private calculateImportDeclarations() {
    const importDeclarations: ImportDeclaration[] = [];
    for (const node of this.program.body) {
      if (node.type === "ImportDeclaration") {
        node.specifiers;
        importDeclarations.push(node);
      }
    }
    return importDeclarations;
  }
  private calculateImportSpecifiersMap() {
    // type AnyImportSpecifier =
    //   | ImportSpecifier
    //   | ImportDefaultSpecifier
    //   | ImportNamespaceSpecifier;
    const importSpecifiersMap = new Map<string, Array<string>>();
    for (const importDeclaration of this.calculateImportDeclarations()) {
      const importDeclarationValue = importDeclaration.source.value;
      if (typeof importDeclarationValue !== "string") {
        throw new Error(
          `Unsupported ImportDeclaration.source.value which is not string. ImportDeclaration: "${importDeclaration}"`
        );
      }
      const importSpecifiers: string[] = [];
      importSpecifiersMap.set(importDeclarationValue, importSpecifiers);
      for (const importSpecifier of importDeclaration.specifiers) {
        // TODO: handle also other types of imports
        if (importSpecifier.type === "ImportSpecifier") {
          if (importSpecifier.imported.type === "Identifier") {
            const importedSpecifierName = importSpecifier.imported.name;
            importSpecifiers.push(importedSpecifierName);
          }
        }
      }
    }
    return importSpecifiersMap;
  }
  private calculateUsedSpecifiersInModuleBody() {
    const usedSpecifiers: string[] = [];
    for (const node of this.program.body) {
      // TODO: support other types of nodes
      if (node.type === "ExpressionStatement") {
        const expression = node.expression;
        if (expression.type === "CallExpression") {
          if (expression.callee.type === "Identifier") {
            const identifierName = expression.callee.name;
            usedSpecifiers.push(identifierName);
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
}
/**
 * Build graph of modules for given entry path.
 */
class Graph {
  private readonly modules = new Map<URL, Module>();
  constructor(private readonly options: Options) {}
  public async build() {
    await this.initModuleRecursively(this.options.input, this.options.parent);
  }
  public shakeImportDeclarations() {
    // TODO: implement passes and max depth of optimizations
    for (const module of this.modules.values()) {
      const notUsedDeclarations = module.calculateNotUsedImportDeclarations();
    }
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
  // private initVertex(module: Module) {
  //   const vertex = new Vertex(module);
  // }
}
// /**
//  * Represents `Module` and its edges
//  */
// class Vertex {
//   constructor(private readonly module: Module) {}
// }
/**
 * Public API of tree shaker.
 */
export const treeShaker = async (options: Options) => {
  const graph = new Graph(options);
  await graph.build();
  return {
    shake() {
      graph.shakeImportDeclarations();

      return "";
    },
  };
};
