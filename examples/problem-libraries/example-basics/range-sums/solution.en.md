Set $s_0=0$ and compute $s_i=s_{i-1}+a_i$. The answer for $[l,r]$ is $s_r-s_{l-1}$, since the subtraction cancels all entries before $l$.

Store the prefix sums in 64-bit integers. The running time is $O(n+q)$ and the space usage is $O(n)$.
