import t from "tap";
import { treeShaker } from "../main.ts";

const fixture = "./fixtures/module-1.js";
t.test("should remove not used import", async (t) => {
  const shaker = await treeShaker({
    chunks: {
      [fixture]: fixture,
    },
    parent: new URL(import.meta.url),
  });
  t.ok(shaker, "should return initial shaker object");
  // const shadedCode = shaker.generate();
  const [shadedCode] = shaker.generate();
  t.notOk(/module-3.js/.test(shadedCode), "should strip unused imports");
  t.ok(/module-2.js/.test(shadedCode), "should do not strip used imports");
});
