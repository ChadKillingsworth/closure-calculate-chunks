import fs from 'fs';
import graphlib from 'graphlib';
import path from 'path';
import Module from 'module';
import url from 'url';
import ChunkGraph from './chunk-graph.js';
import {NAMING_STYLE, outputChunkNaming} from './chunk-naming.js';

function hsv2rgb(h, s, v) {
  h = ((h % 1) + 1) % 1; // wrap hue

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));

  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    case 5:
      return [v, p, q];
    default:
      return [0, 0, 0];
  }
}

function percentageToColor(p) {
  const rgb = hsv2rgb((1 - p) / 3, 1, 0.7);
  return `rgb(${rgb.map((x) => Math.floor(256 * x)).join(',')})`;
}

/**
 * @param {!graphlib.Graph} graph
 * @param {function(string): string} getOutputChunkName
 * @return {{nodes: Array, edges: Array}}
 */
function convertGraph(graph, getOutputChunkName) {
  const chunkCount = graph.nodes().length;
  const nodes = [];
  const edges = [];
  let maxSize = 0;
  graph.nodes().forEach((nodeName) => {
    maxSize = Math.max(maxSize, graph.node(nodeName).sources.size);
  });
  graph.nodes().forEach((nodeName, idx) => {
    const node = graph.node(nodeName);
    const chunkName = getOutputChunkName(nodeName);
    let color = percentageToColor(
        Math.pow((node.sources.size + 1) / (maxSize + 1), 1 / 4)
    );
    if (graph.outEdges(nodeName).length === 0) {
      color = 'rgba(02,02,02,.3)';
    }
    nodes.push({
      id: nodeName,
      chunkId: nodeName,
      size: Math.ceil(Math.sqrt(node.sources.size + 1)),
      shortLabel: chunkName,
      label: chunkName,
      x: Math.cos((idx / chunkCount) * Math.PI * 2) * chunkCount,
      y: Math.sin((idx / chunkCount) * Math.PI * 2) * chunkCount,
      color: color
    });
    graph.inEdges(nodeName).forEach((edge) => {
      edges.push({
        id: `edge-${edge.w}-${edge.v}`,
        source: edge.w,
        target: edge.v,
        arrow: 'target',
        type: 'arrow',
        size: graph.inEdges(edge.w).length
      });
    });
  });

  return {
    nodes,
    edges
  };
}

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const require = Module.createRequire(import.meta.url);

/**
 * Generate an HTML visualization of a chunk graph
 *
 * @param {!ChunkGraph} chunkGraph
 * @param {!NAMING_STYLE=} namingStyle
 * @return {!Promise<string>}
 */
export default async function generateHtml(chunkGraph, namingStyle = NAMING_STYLE.ENTRYPOINT) {
  const getOutputChunkName = outputChunkNaming(chunkGraph.entrypoint, namingStyle);
  const replacements = {
    'entrypoint': getOutputChunkName(chunkGraph.entrypoint),
    'sigma_path': require.resolve('sigma/build/sigma.min.js'),
    'sigma_force_atlas_path': require.resolve('sigma/build/plugins/sigma.layout.forceAtlas2.min.js'),
    'load_graph': JSON.stringify(convertGraph(chunkGraph.graph, getOutputChunkName)),
    'dep_graph': JSON.stringify(convertGraph(chunkGraph.toDependencyGraph(), getOutputChunkName))
  };

  const templateContents = await new Promise((resolve, reject) => {
    fs.readFile(path.join(__dirname, 'visualize-graph.html'), 'utf8', (err, contents) => {
      if (err) {
        return reject(err);
      }
      resolve(contents);
    })
  });

  let html = templateContents;
  Object.keys(replacements).forEach((keyName) => {
    for (let index = html.indexOf(`{{${keyName}}}`); index >= 0; index = html.indexOf(`{{${keyName}}`, index + 1)) {
      html = html.substr(0, index) +
          replacements[keyName] +
          html.substr(index + keyName.length + 4);
    }
  });
  return html;
};
