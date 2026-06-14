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

/** Resolve once MathJax has finished loading; reject if it never does. */
function whenReady(timeoutMs = 10000): Promise<NonNullable<MathJaxGlobal["typesetPromise"]>> {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const step = 50;
    const poll = () => {
      const mj = mathJax();
      if (mj !== undefined && typeof mj.typesetPromise === "function") {
        resolve(mj.typesetPromise.bind(mj));
        return;
      }
      elapsed += step;
      if (elapsed >= timeoutMs) {
        reject(
          new Error(
            "typesetMath: window.MathJax.typesetPromise never became available — the page must load MathJax",
          ),
        );
        return;
      }
      setTimeout(poll, step);
    };
    poll();
  });
}

/** Re-typeset the math in `el` once MathJax is ready. */
export async function typesetMath(el: Element): Promise<void> {
  const typeset = await whenReady();
  mathJax()?.typesetClear?.([el]);
  await typeset([el]);
}
