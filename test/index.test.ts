import 'jest';      // Ref: https://jestjs.io/docs/en/expect#reference
import { StatusManager } from '../src/index'


test("construction", () => {
  const m = new StatusManager(5);
});

