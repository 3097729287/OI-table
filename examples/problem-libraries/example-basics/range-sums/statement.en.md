Given a sequence of $n$ integers and $q$ queries, return the sum from index $l$ through index $r$, inclusive, for each query.

## Input

The first line contains $n$ and $q$, with $1 \le n,q \le 200000$. The second line contains $n$ integers whose absolute values are at most $10^9$. The next $q$ lines each contain two integers $l,r$, with $1 \le l \le r \le n$.

## Output

Print one range sum per line, in query order.

## Example 1

```text
5 3
4 -2 7 0 3
1 3
2 5
4 4
```

```text
9
8
0
```

## Example 2

```text
4 3
1000000000 1000000000 1000000000 -1000000000
1 3
4 4
1 4
```

```text
3000000000
-1000000000
2000000000
```
