import * as L from "llamaindex";
const want = ["VectorStoreIndex", "Document", "Settings", "BaseEmbedding", "SentenceSplitter", "TextNode", "MetadataMode", "SimilarityType", "IndexRetriever", "BaseRetriever"];
for (const w of want) console.log(w, typeof L[w]);
