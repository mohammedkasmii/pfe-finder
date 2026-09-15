export default function OffersLoading() {
  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
      <div className="h-8 w-64 animate-pulse rounded-sm bg-line" />
      <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded-sm bg-line" />
      <div className="mt-8 h-40 animate-pulse rounded-md bg-line" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-48 animate-pulse rounded-md bg-line" />
        ))}
      </div>
    </main>
  )
}
