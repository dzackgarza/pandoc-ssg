// Typeset math inside island-rendered DOM with the page's global MathJax — the
// same instance, delimiters, and macros as static page content (one math path).
//
// Islands mount their content after MathJax's startup typeset pass, so that pass
// never sees them; this re-typesets a freshly rendered subtree. MathJax loads
// asynchronously from a CDN, so wait until its `typesetPromise` is available
// rather than assuming it is ready when the island mounts.

interface MathJaxGlobal {
  typesetPromise?: (elements: Element[]) => Promise<void>;
  typesetClear?: (elements: Element[]) => void;
}

function mathJax(): MathJaxGlobal | undefined {
  return (globalThis as { MathJax?: MathJaxGlobal }).MathJax;
}

function readyMathJax(): NonNullable<MathJaxGlobal["typesetPromise"]> | undefined {
  let mj = mathJax();
  if (mj && typeof mj.typesetPromise === "function") {
    return mj.typesetPromise.bind(mj);
  }
  return undefined;
}

/** Resolve once MathJax has finished loading; reject if it never does. */
function whenReady(timeoutMs: number): Promise<NonNullable<MathJaxGlobal["typesetPromise"]>> {
  return new Promise((resolve, reject) => {
    let deadline = performance.now() + timeoutMs;
    let poll = (): void => {
      let typeset = readyMathJax();
      if (typeset) {
        resolve(typeset);
        return;
      }
      if (performance.now() >= deadline) {
        reject(
          new Error(
            "typesetMath: window.MathJax.typesetPromise never became available — the page must load MathJax",
          ),
        );
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

/** Re-typeset the math in `el` once MathJax is ready. */
export async function typesetMath(el: Element, timeoutMs: number): Promise<void> {
  let typeset = await whenReady(timeoutMs);
  let mj = mathJax();
  if (mj && typeof mj.typesetClear === "function") {
    mj.typesetClear([el]);
  }
  await typeset([el]);
}
