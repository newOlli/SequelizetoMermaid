const fs = require("fs");
const path = require("path");

const modelsDir = path.join(__dirname, "src", "models");
const outputFile = path.join(__dirname, "mermaid-diagram.mmd");

function removeComments(str) {
  return str
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, ""); 
}

function parseAttributes(attributesBlock) {
  const fieldRegex = /(\w+)\s*:\s*{([\s\S]*?)}(?=,\s*\w+\s*:|,\s*}|})/g;

  const fields = [];
  let match;

  while ((match = fieldRegex.exec(attributesBlock)) !== null) {
    const fieldName = match[1];
    const fieldProps = match[2];

    let type = "UNKNOWN";
    const typeTop = fieldProps.match(/type\s*:\s*DataTypes\.(\w+)\s*(\([^)]*\))?/);

    if (typeTop) {
      type = typeTop[1].toUpperCase();

      if (type === "ARRAY") {
        const inner = fieldProps.match(/DataTypes\.ARRAY\(\s*DataTypes\.(\w+)/);
        if (inner) type = `ARRAY<${inner[1].toUpperCase()}>`;
      } else if (type === "ENUM") {
        type = "ENUM";
      }
    }

    const nullable = /allowNull\s*:\s*true/.test(fieldProps) ? "[nullable]" : "";
    const pk = /primaryKey\s*:\s*true/.test(fieldProps) ? " PK" : "";
    const fk = !pk && /id$/i.test(fieldName) ? " FK" : "";

    fields.push(`${type} ${fieldName}${nullable}${pk}${fk}`);
  }

  return fields;
}

function extractModelInfo(fileContent) {
  const prettierFileContent = fileContent.replace(/'/g, '"');

  const defineRegexDoubleQuote =
    /const\s+(\w+)\s*=\s*sequelize\.define(?:<[^">]+>)?\s*\(\s*"[^]+"\s*,\s*({[\s\S]*?})\s*,\s*{[\s\S]*?}\s*\)/m;
  let match = prettierFileContent.match(defineRegexDoubleQuote);

  if (!match) {
    return null;
  }

  const modelName = match[1];
  const attributesBlock = match[2];
  const cleanedAttributesBlock = removeComments(attributesBlock);

  const fields = parseAttributes(cleanedAttributesBlock);

  return { modelName, fields };
}

function generateMermaid(models, associations = []) {
  const entities = models
    .map(m => `${m.modelName} {\n    ${m.fields.join("\n    ")}\n}`)
    .join("\n\n");
  const relations = associations.map(a => a).join("\n");
  return `erDiagram \n${entities}\n\n${relations}`;
}

function parseAssociations(fileContent) {
  const cleaned = removeComments(fileContent);

  const assocRegex =
    /([A-Za-z_]\w*)\s*\.\s*(hasMany|belongsTo|hasOne|belongsToMany)\s*\(\s*([A-Za-z_]\w*)\s*(?:,\s*{([\s\S]*?)})?\s*\)/g;

  const results = [];
  let match;

  while ((match = assocRegex.exec(cleaned)) !== null) {
    const source = match[1];
    const type = match[2];
    const target = match[3];
    const options = match[4] || "";

    const foreignKey = (options.match(/foreignKey\s*:\s*"'["']/) || [])[1];
    const sourceKey = (options.match(/sourceKey\s*:\s*"'["']/) || [])[1];
    const targetKey = (options.match(/targetKey\s*:\s*"'["']/) || [])[1];
    const as = (options.match(/as\s*:\s*"'["']/) || [])[1];
    const through = (options.match(/through\s*:\s*["'"']/) || [])[1];

    results.push({
      source,
      type, // 'hasMany' | 'belongsTo' | 'hasOne' | 'belongsToMany'
      target,
      foreignKey,
      sourceKey,
      targetKey,
      as,
      through,
    });
  }

  return results;
}

function buildRelationshipEdges(allAssociations) {
  const pairs = new Map();

  for (const a of allAssociations) {
    const left = a.source;
    const right = a.target;
    const [m1, m2] = [left, right].sort();
    const key = `${m1}::${m2}`;

    if (!pairs.has(key)) {
      pairs.set(key, { a: m1, b: m2, types: [] });
    }
    pairs
      .get(key)
      .types.push({ from: left, to: right, type: a.type, as: a.as, through: a.through });
  }

  const edges = [];

  for (const { a, b, types } of pairs.values()) {
    // What directions exist?
    const typesFromAtoB = types.filter(t => t.from === a && t.to === b).map(t => t.type);
    const typesFromBtoA = types.filter(t => t.from === b && t.to === a).map(t => t.type);

    const hasManySideA = typesFromAtoB.includes("hasMany");
    const hasOneSideA = typesFromAtoB.includes("hasOne");
    const belongsToSideA = typesFromAtoB.includes("belongsTo");
    const belongsToManyA = typesFromAtoB.includes("belongsToMany");

    const hasManySideB = typesFromBtoA.includes("hasMany");
    const hasOneSideB = typesFromBtoA.includes("hasOne");
    const belongsToSideB = typesFromBtoA.includes("belongsTo");
    const belongsToManyB = typesFromBtoA.includes("belongsToMany");

    let symbol = "";
    let leftEntity = a;
    let rightEntity = b;
    let label = ""; // optional label

    // Many-to-many if either side says belongsToMany
    if (belongsToManyA || belongsToManyB) {
      symbol = "}o--o{";
      label = ` : "many-to-many"`;
    }
    // One-to-many if we have hasMany on one side and belongsTo on the other
    else if ((hasManySideA && belongsToSideB) || (hasManySideB && belongsToSideA)) {
      symbol = "||--o{";
      label = ` : "one-to-many"`;
      // Put the hasMany side on the left for readability
      if (hasManySideB) {
        leftEntity = b;
        rightEntity = a;
      }
    }
    // One-to-one if hasOne on one side and belongsTo on the other
    else if ((hasOneSideA && belongsToSideB) || (hasOneSideB && belongsToSideA)) {
      symbol = "||--||";
      label = ` : "one-to-one"`;
      if (hasOneSideB) {
        leftEntity = b;
        rightEntity = a;
      }
    }
    // Fallback heuristics if only one side is declared
    else if (hasManySideA || hasManySideB) {
      symbol = "||--o{";
      label = ` : "one-to-many"`;
      if (hasManySideB) {
        leftEntity = b;
        rightEntity = a;
      }
    } else if (hasOneSideA || hasOneSideB) {
      symbol = "||--||";
      abel = ` : "one-to-one"`;
      if (hasOneSideB) {
        leftEntity = b;
        rightEntity = a;
      }
    } else if (belongsToSideA || belongsToSideB) {
      // If we only see belongsTo, we’ll render as many-to-one from the target to source
      // Mermaid does not have a native "many-to-one", but direction isn't strict; we’ll show `||--o{` with parent left.
      symbol = "||--o{";
      label = ` : "one-to-many"`;

      if (belongsToSideA && !belongsToSideB) {
        leftEntity = b; // parent
        rightEntity = a; // child
      } else if (belongsToSideB && !belongsToSideA) {
        leftEntity = a; // parent
        rightEntity = b; // child
      }
    }

    const aliases = types.map(t => t.as).filter(Boolean);
    if (aliases.length) {
      label = ` : ${[...new Set(aliases)].join(", ")}`;
    }

    edges.push(`${leftEntity} ${symbol} ${rightEntity}${label}`);
  }

  return [...new Set(edges)];
}

function main() {
  //So that you can create db pictures of specific files - not 100% correct associations so you need to do manual cleanup
  const onlyTheseFiles = [];

  const files = fs.readdirSync(modelsDir).filter(f => f.endsWith(".ts") || f.endsWith(".js"));
  const models = [];
  const allAssociations = [];

  files.forEach(file => {
    if (onlyTheseFiles.length > 0 && !onlyTheseFiles.includes(file)) {
      return;
    }
    const content = fs.readFileSync(path.join(modelsDir, file), "utf-8");
    const modelInfo = extractModelInfo(content);
    if (modelInfo) {
      models.push(modelInfo);
    }

    const association = parseAssociations(content);
    if (association.length) {
      allAssociations.push(...association);
    }
  });

  const relationshipEdges = buildRelationshipEdges(allAssociations);
  const mermaidCode = generateMermaid(models, relationshipEdges);

  console.log("Found: ", files.length, " files");
  console.log(files);
  console.log("Found: ", models.length, " models");

  fs.writeFileSync(outputFile, mermaidCode, "utf-8");
  console.log(`MermaidJS ER diagram written to ${outputFile}`);
}

main();
