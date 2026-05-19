#!/usr/bin/env python3
"""CLIP embeddings + DBSCAN clustering + near-duplicate detection.
Usage: python3 cluster.py <filelist_json> <output_json> [--eps 0.3] [--threshold 0.95]
   filelist_json: JSON array of full paths to image files
   output_json:   path to write cluster results
"""

import sys, os, json

def main():
    if len(sys.argv) < 3:
        print("Usage: cluster.py <filelist_json> <output_json> [--eps 0.3] [--threshold 0.95]", file=sys.stderr)
        sys.exit(1)

    filelist_path = sys.argv[1]
    output_path = sys.argv[2]
    eps = 0.3
    sim_threshold = 0.95

    args_list = sys.argv[3:]
    for i, arg in enumerate(args_list):
        if arg == '--eps' and i + 1 < len(args_list):
            eps = float(args_list[i + 1])
        elif arg == '--threshold' and i + 1 < len(args_list):
            sim_threshold = float(args_list[i + 1])

    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
        from sklearn.cluster import DBSCAN
        from sklearn.preprocessing import normalize
        from PIL import Image
    except ImportError as e:
        print(f"ERROR_MISSING_DEPS: {e}", file=sys.stderr)
        sys.exit(2)

    with open(filelist_path) as f:
        all_paths = json.load(f)

    valid = []
    for p in all_paths:
        ext = os.path.splitext(p)[1].lower()
        if ext in {'.jpg', '.jpeg', '.png', '.webp'} and os.path.isfile(p):
            valid.append(p)

    if not valid:
        print(json.dumps({"version": 1, "total_photos": 0, "total_clusters": 0, "clusters": [], "photos": {}, "representatives": {}}))
        return

    print(f"Loading CLIP model...", file=sys.stderr)
    model = SentenceTransformer('clip-ViT-B-32')

    total_valid = len(valid)
    print(f"Generating embeddings for {total_valid} images...", file=sys.stderr)
    embeddings = []
    image_files = []
    for idx, fpath in enumerate(valid):
        try:
            img = Image.open(fpath).convert('RGB')
            emb = model.encode(img)
            embeddings.append(emb)
            image_files.append(fpath)
        except Exception as e:
            print(f"Warning: {os.path.basename(fpath)}: {e}", file=sys.stderr)
        if (idx + 1) % 100 == 0 or idx + 1 == total_valid:
            pct = (idx + 1) / total_valid * 100
            print(f"  Embeddings: {idx + 1}/{total_valid} ({pct:.0f}%)", file=sys.stderr)

    if not image_files:
        print(json.dumps({"version": 1, "total_photos": 0, "total_clusters": 0, "clusters": [], "photos": {}, "representatives": {}}))
        return

    embeddings = np.array(embeddings)
    normalized = normalize(embeddings)

    print(f"Clustering {len(image_files)} embeddings (eps={eps})...", file=sys.stderr)
    clustering = DBSCAN(metric='cosine', eps=eps, min_samples=2).fit(normalized)
    labels = clustering.labels_.tolist()

    clusters_map = {}
    for fpath, label in zip(image_files, labels):
        clusters_map.setdefault(label, []).append(fpath)

    print(f"Detecting near-duplicates...", file=sys.stderr)
    clusters_output = []
    centroids = {}

    for label, files in clusters_map.items():
        if label == -1:
            continue
        indices = [image_files.index(f) for f in files]
        cluster_emb = embeddings[indices]
        cluster_norm = normalize(cluster_emb)

        near_dups = []
        for i in range(len(files)):
            for j in range(i + 1, len(files)):
                sim = float(np.dot(cluster_norm[i], cluster_norm[j]))
                if sim > sim_threshold:
                    near_dups.append([files[i], files[j]])

        centroid = np.mean(cluster_emb, axis=0)
        centroid_norm = centroid / np.linalg.norm(centroid)
        sims = np.dot(cluster_norm, centroid_norm).tolist()
        ranked = sorted(zip(files, sims), key=lambda x: -x[1])
        top3 = [f[0] for f in ranked[:3]]

        clusters_output.append({
            "id": int(label),
            "files": files,
            "near_duplicates": near_dups,
            "count": len(files)
        })
        centroids[int(label)] = top3

    output = {
        "version": 1,
        "total_photos": len(image_files),
        "total_clusters": len(clusters_output),
        "noise_count": len(clusters_map.get(-1, [])),
        "clusters": clusters_output,
        "representatives": centroids
    }

    with open(output_path, 'w') as f:
        json.dump(output, f, ensure_ascii=False)

    total_processed = len(image_files)
    total_clusters = len(clusters_output)
    total_noise = len(clusters_map.get(-1, []))
    print(f"Done: {total_processed} photos → {total_clusters} clusters, {total_noise} unclustered", file=sys.stderr)


if __name__ == "__main__":
    main()
