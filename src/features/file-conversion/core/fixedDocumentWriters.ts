import JSZip from "jszip";

export type RenderedPage = {
  blob: Blob;
  width: number;
  height: number;
};

const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function relationships(entries: Array<{ id: string; type: string; target: string }>) {
  return `${xmlDeclaration}<Relationships xmlns="${relationshipNamespace}">${entries
    .map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
}

function fitContain(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const fittedWidth = Math.round(sourceWidth * scale);
  const fittedHeight = Math.round(sourceHeight * scale);
  return {
    height: fittedHeight,
    width: fittedWidth,
    x: Math.round((width - fittedWidth) / 2),
    y: Math.round((height - fittedHeight) / 2),
  };
}

async function archiveBlob(zip: JSZip) {
  return zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: "application/octet-stream",
    type: "blob",
  });
}

function addCoreProperties(zip: JSZip, application: string) {
  zip.file(
    "docProps/core.xml",
    `${xmlDeclaration}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>PixelLock PDF conversion</dc:title><dc:creator>PixelLock</dc:creator><cp:lastModifiedBy>PixelLock</cp:lastModifiedBy></cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${xmlDeclaration}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${application}</Application><AppVersion>1.0</AppVersion></Properties>`,
  );
}

export async function pagesToPptx(pages: RenderedPage[]) {
  const zip = new JSZip();
  const slideWidth = 12_192_000;
  const slideHeight = 6_858_000;
  addCoreProperties(zip, "PixelLock Presentation Exporter");
  zip.file(
    "[Content_Types].xml",
    `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${pages.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([
      { id: "rId1", target: "ppt/presentation.xml", type: `${officeRelationshipNamespace}/officeDocument` },
      { id: "rId2", target: "docProps/core.xml", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" },
      { id: "rId3", target: "docProps/app.xml", type: `${officeRelationshipNamespace}/extended-properties` },
    ]),
  );
  zip.file(
    "ppt/presentation.xml",
    `${xmlDeclaration}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationshipNamespace}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${slideWidth}" cy="${slideHeight}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relationships([
      { id: "rId1", target: "slideMasters/slideMaster1.xml", type: `${officeRelationshipNamespace}/slideMaster` },
      ...pages.map((_, index) => ({ id: `rId${index + 2}`, target: `slides/slide${index + 1}.xml`, type: `${officeRelationshipNamespace}/slide` })),
    ]),
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `${xmlDeclaration}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationshipNamespace}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="PixelLock"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relationships([
      { id: "rId1", target: "../slideLayouts/slideLayout1.xml", type: `${officeRelationshipNamespace}/slideLayout` },
      { id: "rId2", target: "../theme/theme1.xml", type: `${officeRelationshipNamespace}/theme` },
    ]),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `${xmlDeclaration}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationshipNamespace}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relationships([{ id: "rId1", target: "../slideMasters/slideMaster1.xml", type: `${officeRelationshipNamespace}/slideMaster` }]),
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `${xmlDeclaration}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PixelLock"><a:themeElements><a:clrScheme name="PixelLock"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="404040"/></a:accent1><a:accent2><a:srgbClr val="808080"/></a:accent2><a:accent3><a:srgbClr val="A0A0A0"/></a:accent3><a:accent4><a:srgbClr val="606060"/></a:accent4><a:accent5><a:srgbClr val="B0B0B0"/></a:accent5><a:accent6><a:srgbClr val="303030"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="PixelLock"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="PixelLock"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  );

  pages.forEach((page, index) => {
    const slideNumber = index + 1;
    const fitted = fitContain(page.width, page.height, slideWidth, slideHeight);
    zip.file(`ppt/media/image${slideNumber}.png`, page.blob);
    zip.file(
      `ppt/slides/slide${slideNumber}.xml`,
      `${xmlDeclaration}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationshipNamespace}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="PDF page ${slideNumber}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${fitted.x}" y="${fitted.y}"/><a:ext cx="${fitted.width}" cy="${fitted.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      relationships([
        { id: "rId1", target: `../media/image${slideNumber}.png`, type: `${officeRelationshipNamespace}/image` },
        { id: "rId2", target: "../slideLayouts/slideLayout1.xml", type: `${officeRelationshipNamespace}/slideLayout` },
      ]),
    );
  });
  return archiveBlob(zip);
}

export async function pagesToDocx(pages: RenderedPage[]) {
  const zip = new JSZip();
  addCoreProperties(zip, "PixelLock Word Exporter");
  zip.file(
    "[Content_Types].xml",
    `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([
      { id: "rId1", target: "word/document.xml", type: `${officeRelationshipNamespace}/officeDocument` },
      { id: "rId2", target: "docProps/core.xml", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" },
      { id: "rId3", target: "docProps/app.xml", type: `${officeRelationshipNamespace}/extended-properties` },
    ]),
  );
  const pageWidth = 7_500_000;
  const pageHeight = 10_500_000;
  const body = pages.map((page, index) => {
    const fitted = fitContain(page.width, page.height, pageWidth, pageHeight);
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${fitted.width}" cy="${fitted.height}"/><wp:docPr id="${index + 1}" name="PDF page ${index + 1}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index + 1}" name="PDF page ${index + 1}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${fitted.width}" cy="${fitted.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${index < pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}`;
  }).join("");
  zip.file(
    "word/document.xml",
    `${xmlDeclaration}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${officeRelationshipNamespace}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    relationships(pages.map((_, index) => ({ id: `rId${index + 1}`, target: `media/image${index + 1}.png`, type: `${officeRelationshipNamespace}/image` }))),
  );
  pages.forEach((page, index) => zip.file(`word/media/image${index + 1}.png`, page.blob));
  return archiveBlob(zip);
}

export async function pagesToXlsx(pages: RenderedPage[]) {
  const zip = new JSZip();
  addCoreProperties(zip, "PixelLock Spreadsheet Exporter");
  zip.file(
    "[Content_Types].xml",
    `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${pages.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([
      { id: "rId1", target: "xl/workbook.xml", type: `${officeRelationshipNamespace}/officeDocument` },
      { id: "rId2", target: "docProps/core.xml", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" },
      { id: "rId3", target: "docProps/app.xml", type: `${officeRelationshipNamespace}/extended-properties` },
    ]),
  );
  zip.file(
    "xl/workbook.xml",
    `${xmlDeclaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${officeRelationshipNamespace}"><sheets>${pages.map((_, index) => `<sheet name="Page ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    relationships([
      ...pages.map((_, index) => ({ id: `rId${index + 1}`, target: `worksheets/sheet${index + 1}.xml`, type: `${officeRelationshipNamespace}/worksheet` })),
      { id: `rId${pages.length + 1}`, target: "styles.xml", type: `${officeRelationshipNamespace}/styles` },
    ]),
  );
  zip.file(
    "xl/styles.xml",
    `${xmlDeclaration}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
  );
  pages.forEach((page, index) => {
    const number = index + 1;
    const widthEmu = Math.round(page.width * 9_525);
    const heightEmu = Math.round(page.height * 9_525);
    zip.file(
      `xl/worksheets/sheet${number}.xml`,
      `${xmlDeclaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${officeRelationshipNamespace}"><sheetData/><drawing r:id="rId1"/></worksheet>`,
    );
    zip.file(
      `xl/worksheets/_rels/sheet${number}.xml.rels`,
      relationships([{ id: "rId1", target: `../drawings/drawing${number}.xml`, type: `${officeRelationshipNamespace}/drawing` }]),
    );
    zip.file(
      `xl/drawings/drawing${number}.xml`,
      `${xmlDeclaration}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${widthEmu}" cy="${heightEmu}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${number}" name="PDF page ${number}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${officeRelationshipNamespace}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`,
    );
    zip.file(
      `xl/drawings/_rels/drawing${number}.xml.rels`,
      relationships([{ id: "rId1", target: `../media/image${number}.png`, type: `${officeRelationshipNamespace}/image` }]),
    );
    zip.file(`xl/media/image${number}.png`, page.blob);
  });
  return archiveBlob(zip);
}

export async function pagesToXps(pages: RenderedPage[]) {
  const zip = new JSZip();
  const xpsNamespace = "http://schemas.microsoft.com/xps/2005/06";
  zip.file(
    "[Content_Types].xml",
    `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/FixedDocumentSequence.fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/><Override PartName="/Documents/1/FixedDocument.fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>${pages.map((_, index) => `<Override PartName="/Documents/1/Pages/${index + 1}.fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([{ id: "rId1", target: "/FixedDocumentSequence.fdseq", type: `${xpsNamespace}/fixedrepresentation` }]),
  );
  zip.file(
    "FixedDocumentSequence.fdseq",
    `${xmlDeclaration}<FixedDocumentSequence xmlns="${xpsNamespace}"><DocumentReference Source="/Documents/1/FixedDocument.fdoc"/></FixedDocumentSequence>`,
  );
  zip.file(
    "Documents/1/FixedDocument.fdoc",
    `${xmlDeclaration}<FixedDocument xmlns="${xpsNamespace}">${pages.map((_, index) => `<PageContent Source="/Documents/1/Pages/${index + 1}.fpage"/>`).join("")}</FixedDocument>`,
  );
  pages.forEach((page, index) => {
    const number = index + 1;
    const width = Math.max(1, Math.round(page.width / 2));
    const height = Math.max(1, Math.round(page.height / 2));
    zip.file(
      `Documents/1/Pages/${number}.fpage`,
      `${xmlDeclaration}<FixedPage xmlns="${xpsNamespace}" Width="${width}" Height="${height}" xml:lang="en-US"><Path Data="M 0,0 L ${width},0 ${width},${height} 0,${height} Z"><Path.Fill><ImageBrush ImageSource="/Documents/1/Resources/Images/${number}.png" Viewbox="0,0,${page.width},${page.height}" ViewboxUnits="Absolute" Viewport="0,0,${width},${height}" ViewportUnits="Absolute"/></Path.Fill></Path></FixedPage>`,
    );
    zip.file(
      `Documents/1/Pages/_rels/${number}.fpage.rels`,
      relationships([{ id: "rId1", target: `../Resources/Images/${number}.png`, type: `${xpsNamespace}/required-resource` }]),
    );
    zip.file(`Documents/1/Resources/Images/${number}.png`, page.blob);
  });
  return archiveBlob(zip);
}
