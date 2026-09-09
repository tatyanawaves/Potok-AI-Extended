# Analysis of Recommendation Algorithms for Modern Social Networks

## 1. Introduction
Recommendation systems (RecSys) are the backbone of modern social networks (TikTok, Instagram, YouTube, X). Their goal is to maximize user engagement, retention, and monetization by surfacing relevant content from billions of available items.

## 2. Types of Algorithms

### A. Collaborative Filtering (CF)
*   **User-Based CF:** Recommends items liked by similar users.
*   **Item-Based CF:** Recommends items similar to those the user has interacted with (using item-item similarity matrices).
*   **Matrix Factorization (MF):** Decomposes the user-item interaction matrix into low-dimensional latent factors (e.g., SVD, ALS).

### B. Content-Based Filtering
*   Analyzes item features (text, tags, image embeddings, video metadata).
*   Matches item profiles with user preference profiles.
*   *Pros:* No "cold start" for new items. *Cons:* Limited discovery (filter bubbles).

### C. Hybrid Systems
*   Combines CF and Content-Based methods to leverage the strengths of both.
*   Most industrial systems (e.g., Netflix, Spotify) are hybrid.

### D. Modern Deep Learning Architectures
*   **Two-Tower Models:** Separate neural networks for User and Item embeddings. The final recommendation is based on the dot product of these embeddings. Highly scalable for retrieval.
*   **Graph Neural Networks (GNNs):** Model social networks as graphs where nodes are users/items and edges are interactions. Systems like PinSage (Pinterest) use GNNs to capture high-order relationships.
*   **Transformers (Sequential Models):** Used to capture the "chronological" interest of a user (e.g., BST - Behavior Sequence Transformer).
*   **Deep Interest Network (DIN):** Dynamically learns user interests based on their historical behavior relative to a candidate item.

## 3. Implementation Pipeline

1.  **Data Ingestion:** Collecting implicit (clicks, watch time, shares) and explicit (likes, ratings) feedback.
2.  **Retrieval (Candidate Generation):** Selecting the top ~1000 candidates from millions using fast approximate nearest neighbor search (Faiss, Hnswlib) or simple heuristics.
3.  **Ranking:** A heavy deep learning model (e.g., DeepFM, DCN V2) scores the candidates based on hundreds of features (user demographics, context, item popularity).
4.  **Re-Ranking & Diversification:** Applying business logic, removing duplicates, and ensuring a mix of content types to prevent fatigue (using Determinantal Point Processes - DPP).

## 4. Key Metrics

### A. Accuracy & Ranking Metrics
*   **Precision@K / Recall@K:** Accuracy in the top K results.
*   **NDCG (Normalized Discounted Cumulative Gain):** Rewards models that put relevant items at the very top.
*   **MRR (Mean Reciprocal Rank):** Average of the reciprocal of the rank of the first relevant item.
*   **AUC (Area Under ROC Curve):** Measures the probability that a randomly chosen positive item is ranked higher than a negative one.

### B. Beyond-Accuracy Metrics
*   **Diversity:** Measures how different the recommended items are from each other.
*   **Novelty:** How "surprising" or "unseen" the items are (long-tail recommendations).
*   **Serendipity:** Finding items that are both unexpected and highly relevant.
*   **Coverage:** Percentage of items in the catalog that the system is able to recommend.

### C. Business Metrics
*   **CTR (Click-Through Rate):** Clicks / Impressions.
*   **Conversion Rate:** Percentage of users who take a desired action (e.g., follow, buy).
*   **Retention / LTV:** Long-term impact on user return rate.
*   **Watch Time / Session Length:** Crucial for video platforms like TikTok.

## 5. Challenges
*   **Cold Start:** Recommending to new users or recommending new items.
*   **Scalability:** Handling billions of users/items in real-time (< 100ms latency).
*   **Bias:** Popularity bias (rich get richer) and echo chambers.
*   **Exploration vs. Exploitation:** Balancing "what we know the user likes" with "discovering new interests".
