Store both directions of each edge in adjacency lists. Check each vertex in order. Whenever you find an unvisited vertex, add one to the answer and run breadth-first search from that vertex to mark its entire component.

The time and space usage are both $O(n+m)$.
