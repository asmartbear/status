import 'jest';      // Ref: https://jestjs.io/docs/en/expect#reference
import { getCommonPrefixLength, StatusManager } from '../src/index'


test("construction", () => {
  const m = new StatusManager();
});

test("getCommonPrefixLength", () => {
  const tst = (a: string, b: string, n: number) => expect(getCommonPrefixLength(a, b)).toEqual(n)

  tst("", "", 0)
  tst("", "a", 0)
  tst("a", "", 0)
  tst("a", "a", 1)
  tst("ab", "a", 1)
  tst("a", "ab", 1)
  tst("ab", "ab", 2)
  tst("ab", "ac", 1)
  tst("ab", "acdefg", 1)
  tst("ab", "abcdefg", 2)
  tst("abc", "ac", 1)
  tst("abcdef", "ac", 1)
  tst("abcdef", "abc", 3)
  tst("abcdef", "1234", 0)
  tst("abcdef", "1234", 0)
})