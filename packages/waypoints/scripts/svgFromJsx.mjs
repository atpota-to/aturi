// Turns the canonical React icon catalog into standalone SVG markup strings for
// the zero-dependency core package.
//
// The catalog in `src/utils/waypointIcons.tsx` is the single source of truth for
// every waypoint's brand mark, but it is JSX: React spells the hyphenated SVG
// attributes in camelCase, so the source is not valid SVG as written. This
// module does that translation at sync time so `@aturi.to/waypoints/icons` is
// generated from the same file the React package ships, and `sync:check` fails
// on drift the same way it does for every other copy.
//
// The transform is deliberately strict. Every icon in the catalog today is
// static JSX built from a handful of elements and attributes, so anything this
// module does not recognise is a mistake rather than a case to guess at, and it
// throws instead of emitting markup that would be silently wrong.

// React's camelCase spellings for hyphenated SVG/HTML attributes.
const ATTRIBUTE_RENAMES = {
  className: 'class',
  clipPath: 'clip-path',
  clipRule: 'clip-rule',
  colorInterpolationFilters: 'color-interpolation-filters',
  dominantBaseline: 'dominant-baseline',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  letterSpacing: 'letter-spacing',
  mixBlendMode: 'mix-blend-mode',
  paintOrder: 'paint-order',
  shapeRendering: 'shape-rendering',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor',
  vectorEffect: 'vector-effect',
};

// SVG attributes that are genuinely camelCase in the spec and must survive the
// transform untouched. Anything camelCase outside this set and the rename table
// above is unrecognised and stops the build.
const CAMEL_CASE_SVG_ATTRIBUTES = new Set([
  'attributeName',
  'attributeType',
  'baseFrequency',
  'baseProfile',
  'calcMode',
  'clipPathUnits',
  'diffuseConstant',
  'filterUnits',
  'gradientTransform',
  'gradientUnits',
  'kernelMatrix',
  'kernelUnitLength',
  'keySplines',
  'keyTimes',
  'lengthAdjust',
  'markerHeight',
  'markerUnits',
  'markerWidth',
  'maskContentUnits',
  'maskUnits',
  'numOctaves',
  'pathLength',
  'patternContentUnits',
  'patternTransform',
  'patternUnits',
  'preserveAspectRatio',
  'primitiveUnits',
  'refX',
  'refY',
  'repeatCount',
  'repeatDur',
  'requiredExtensions',
  'requiredFeatures',
  'specularConstant',
  'specularExponent',
  'spreadMethod',
  'startOffset',
  'stitchTiles',
  'surfaceScale',
  'systemLanguage',
  'textLength',
  'viewBox',
  'xChannelSelector',
  'yChannelSelector',
  'zoomAndPan',
]);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Attribute values are pulled out before the whitespace pass and put back
// after, so nothing inside a `d="..."` path can be collapsed or reordered. The
// marker is a NUL byte: it cannot occur in the catalog's markup, and `\s` does
// not match it, so the collapse pass leaves it alone. Written as an escape so
// this file stays plain text.
const PLACEHOLDER = '\u0000';

function protectAttributeValues(jsx) {
  const values = [];
  const protectedJsx = jsx.replace(/="([^"]*)"/g, (_match, value) => {
    values.push(value);
    return `="${PLACEHOLDER}${values.length - 1}${PLACEHOLDER}"`;
  });
  return { protectedJsx, values };
}

function restoreAttributeValues(markup, values) {
  return markup.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_match, index) => values[Number(index)],
  );
}

// `strokeWidth={2}` is the only expression form the catalog uses. Numeric
// literals become plain attribute values; anything else is rejected, because a
// runtime expression cannot be resolved into a static string.
function inlineNumericExpressions(jsx, componentName) {
  return jsx.replace(
    /([a-zA-Z][a-zA-Z0-9:_-]*)=\{([^}]*)\}/g,
    (match, name, expression) => {
      const value = expression.trim();
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        throw new Error(
          `${componentName}: cannot statically resolve \`${match}\`. ` +
            'Only numeric literal props are supported in the icon catalog.',
        );
      }
      return `${name}="${value}"`;
    },
  );
}

function renameAttributes(jsx, componentName) {
  return jsx.replace(
    /(\s)([a-zA-Z][a-zA-Z0-9:_-]*)=/g,
    (match, space, name) => {
      if (Object.hasOwn(ATTRIBUTE_RENAMES, name)) {
        return `${space}${ATTRIBUTE_RENAMES[name]}=`;
      }
      if (/[A-Z]/.test(name) && !CAMEL_CASE_SVG_ATTRIBUTES.has(name)) {
        throw new Error(
          `${componentName}: unrecognised camelCase attribute \`${name}\`. ` +
            'Add it to ATTRIBUTE_RENAMES or CAMEL_CASE_SVG_ATTRIBUTES in ' +
            'scripts/svgFromJsx.mjs so the SVG spelling is explicit.',
        );
      }
      return match;
    },
  );
}

// The catalog is pretty-printed across many lines. Collapsing it keeps the
// generated module a fraction of the size without changing what renders:
// whitespace between SVG tags is not significant, and attribute values are
// stashed behind placeholders while this runs.
function collapseWhitespace(markup) {
  return markup
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .trim();
}

// Every mark should stand on its own — pasted into a file, served as an
// `image/svg+xml` response, or encoded into a data URI — and that needs the
// namespace declared. Several icons in the catalog omit it because React
// renders them into an HTML document, where it is implied.
function ensureNamespace(markup, componentName) {
  if (/^<svg[\s>]/.test(markup) === false) {
    throw new Error(`${componentName}: expected the markup to start with <svg>.`);
  }
  if (markup.includes(`xmlns="${SVG_NAMESPACE}"`)) return markup;
  return markup.replace(/^<svg/, `<svg xmlns="${SVG_NAMESPACE}"`);
}

/**
 * Translate one component's JSX body into standalone SVG markup.
 *
 * @param {string} jsx body of the arrow function, `<svg …>…</svg>`
 * @param {string} componentName used only for error messages
 * @returns {string}
 */
export function svgFromJsx(jsx, componentName) {
  if (jsx.includes('{/*')) {
    throw new Error(`${componentName}: JSX comments are not supported.`);
  }

  // `{...props}` only makes sense for a React component; the string form has no
  // props to spread, and the catalog passes nothing a static mark needs.
  let working = jsx.replace(/\s*\{\.\.\.props\}/g, '');
  working = inlineNumericExpressions(working, componentName);

  const { protectedJsx, values } = protectAttributeValues(working);
  if (protectedJsx.includes('{') || protectedJsx.includes('}')) {
    throw new Error(
      `${componentName}: unsupported JSX expression in the icon markup.`,
    );
  }

  const renamed = renameAttributes(protectedJsx, componentName);
  const collapsed = collapseWhitespace(renamed);
  return ensureNamespace(restoreAttributeValues(collapsed, values), componentName);
}

/**
 * Pull every `const Foo = () => (<svg …>)` icon component out of the catalog.
 *
 * @param {string} source contents of `src/utils/waypointIcons.tsx`
 * @returns {Map<string, string>} component name -> JSX body
 */
export function parseIconComponents(source) {
  const components = new Map();
  const pattern = /^(?:export )?const (\w+) = \(\) => \(\n([\s\S]*?)\n\);$/gm;
  for (const match of source.matchAll(pattern)) {
    components.set(match[1], match[2]);
  }
  return components;
}

/**
 * Pull the Anisota mark out of its own component file. It takes props, so it
 * does not match the catalog's zero-argument shape.
 *
 * @param {string} source contents of `src/components/AnisotaLogo.tsx`
 * @returns {string} JSX body
 */
export function parseAnisotaLogo(source) {
  const match = source.match(
    /^export const AnisotaLogo = \(props: SVGProps<SVGSVGElement>\) => \(\n([\s\S]*?)\n\);$/m,
  );
  if (!match) {
    throw new Error('AnisotaLogo: could not locate the component in its source file.');
  }
  return match[1];
}

/**
 * Read the `WAYPOINT_ICONS` map, which is what actually binds a waypoint id to
 * a mark. Order is preserved so the generated module reads like the catalog.
 *
 * @param {string} source contents of `src/utils/waypointIcons.tsx`
 * @returns {Array<{ id: string, component: string }>}
 */
export function parseIconMap(source) {
  const block = source.match(
    /export const WAYPOINT_ICONS: Record<string, ReactNode> = \{\n([\s\S]*?)\n\};/,
  );
  if (!block) {
    throw new Error('Could not locate WAYPOINT_ICONS in the icon catalog.');
  }
  const entries = [];
  for (const line of block[1].split('\n')) {
    const match = line.match(/^\s*(\w+): <(\w+)[^>]*\/>,$/);
    if (!match) {
      throw new Error(`Unrecognised WAYPOINT_ICONS entry: ${line.trim()}`);
    }
    entries.push({ id: match[1], component: match[2] });
  }
  return entries;
}

// Each mark is annotated `: string` rather than left to inference. Without it
// TypeScript widens each const to its own string literal type and the emitted
// declarations carry a second full copy of every mark.
const exportNameForId = (id) => `${id}IconSvg`;

/**
 * Build the generated `waypointIcons.data.ts` module.
 *
 * Marks are emitted once each and aliased where two waypoints share one, which
 * matters more than it looks: the Anisota mark alone is a ~34KB string and two
 * waypoints point at it.
 *
 * @param {string} iconsSource contents of `src/utils/waypointIcons.tsx`
 * @param {string} anisotaSource contents of `src/components/AnisotaLogo.tsx`
 * @returns {string}
 */
export function renderIconDataModule(iconsSource, anisotaSource) {
  const components = parseIconComponents(iconsSource);
  components.set('AnisotaLogo', parseAnisotaLogo(anisotaSource));

  const entries = parseIconMap(iconsSource);
  const ownerByComponent = new Map();
  const lines = [];
  const mapLines = [];

  for (const { id, component } of entries) {
    const jsx = components.get(component);
    if (jsx === undefined) {
      throw new Error(
        `WAYPOINT_ICONS maps "${id}" to <${component}/>, which is not in the catalog.`,
      );
    }
    const name = exportNameForId(id);
    const owner = ownerByComponent.get(component);
    if (owner) {
      lines.push(
        `/** ${id}'s mark, the same one \`${owner}\` carries. */`,
        `export const ${name}: string = ${owner};`,
        '',
      );
    } else {
      ownerByComponent.set(component, name);
      lines.push(
        `/** ${id}'s mark, from <${component}/> in the canonical catalog. */`,
        `export const ${name}: string = ${JSON.stringify(svgFromJsx(jsx, component))};`,
        '',
      );
    }
    mapLines.push(`  ${id}: ${name},`);
  }

  return `// GENERATED FILE - do not edit by hand.
//
// Written by packages/waypoints/scripts/sync.mjs from the canonical catalog in
// src/utils/waypointIcons.tsx (and src/components/AnisotaLogo.tsx). Edit those,
// then run \`npm run sync\` in packages/. CI fails on drift via \`sync:check\`.
//
// Each value is standalone SVG markup: namespaced, sized 24x24, and painted in
// \`currentColor\` so a mark takes the colour of the text around it. A few marks
// knock part of the shape out to \`var(--bg-primary, white)\`; set that variable
// to your own background if white is wrong for your surface.
//
// These are third-party brand marks. The MIT licence on this package covers the
// code, not the trademarks - see the icons section of the README.

${lines.join('\n')}/**
 * Every waypoint's brand mark as standalone SVG markup, keyed by waypoint id.
 *
 * Keys match \`WAYPOINT_ORDER\` in \`waypoints.data\`; every id in that list has
 * an entry here.
 */
export const WAYPOINT_ICON_SVGS: Record<string, string> = {
${mapLines.join('\n')}
};
`;
}
