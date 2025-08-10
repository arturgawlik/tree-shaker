import t from "tap";
import { treeShaker } from "../main.ts";

const fixture = "./fixtures/module-1.js";
t.test("treeShaker", async (t) => {
  const shaker = await treeShaker({
    input: fixture,
    parent: new URL(import.meta.url),
  });
  t.ok(shaker, "should return initial shaker object");
  const shadedCode = shaker.shake();
  t.notOk(/module-3.js/.test(shadedCode), "should strip unused imports");
  t.ok(
    /module-1.js/.test(shadedCode) && /module-2.js/.test(shadedCode),
    "should do not strip used imports"
  );
});
