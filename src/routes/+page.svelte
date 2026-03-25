<script>
	import { assistantActions } from '$lib/stores/assistantStore';
	import { fade, fly } from 'svelte/transition';
	import loanData from '$lib/data/loanProducts.json';

	const loanIcons = {
		'Business Loan': '💼',
		'Loan Against Property (LAP)': '🏢',
		'Plot Loan': '🌍'
	};

	const loanColors = {
		'Business Loan': 'bg-indigo-50 text-indigo-600 border-indigo-100',
		'Loan Against Property (LAP)': 'bg-emerald-50 text-emerald-600 border-emerald-100',
		'Plot Loan': 'bg-amber-50 text-amber-600 border-amber-100'
	};

	const reraStates = [
		{ name: 'Uttar Pradesh', code: 'UP', href: '/up-rera-agent', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: '🏛' },
		{ name: 'Delhi', code: 'DL', href: '/delhi-rera-agent', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: '🏙' },
		{ name: 'Madhya Pradesh', code: 'MP', href: '/mp-rera-agent', color: 'bg-green-50 text-green-700 border-green-200', icon: '🌿' },
		{ name: 'Punjab', code: 'PB', href: '/punjab-rera-agent', color: 'bg-red-50 text-red-700 border-red-200', icon: '🌾' },
		{ name: 'Rajasthan', code: 'RJ', href: '/rajasthan-rera-agent', color: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: '🏜' }
	];

	const stats = [
		{ label: 'States Covered', value: '5+' },
		{ label: 'Loan Products', value: `${loanData.products.length}` },
		{ label: 'Partner Banks', value: '10+' },
		{ label: 'RERA Agents', value: '3000+' }
	];
</script>

<svelte:head>
	<title>RERA Toolkit — Verify Agents & Explore Loans</title>
</svelte:head>

<div class="space-y-20 pb-20">
	<!-- Hero Section -->
	<section class="relative overflow-hidden rounded-3xl bg-slate-900 py-20 px-8 text-white shadow-2xl sm:px-12 lg:py-28">
		<div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.15),transparent)]"></div>
		<div class="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl"></div>
		<div class="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl"></div>

		<div class="relative z-10 mx-auto max-w-3xl text-center">
			<span class="inline-block rounded-full bg-indigo-500/20 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-indigo-300 ring-1 ring-indigo-500/30" in:fade>
				Smart RERA Solutions
			</span>
			<h1 class="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl" in:fly={{ y: 20, duration: 600 }}>
				Verify Agents & <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Secure Loans</span> in Minutes.
			</h1>
			<p class="mt-6 text-lg leading-relaxed text-slate-400 sm:text-xl" in:fly={{ y: 20, duration: 600, delay: 200 }}>
				The comprehensive toolkit for real estate professionals and home buyers.
				Browse registered agents by state and explore tailored loan products.
			</p>

			<div class="mt-10 flex flex-wrap justify-center gap-4" in:fly={{ y: 20, duration: 600, delay: 400 }}>
				<button
					class="rounded-xl bg-indigo-600 px-8 py-4 text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500 hover:scale-105 active:scale-95"
					on:click={() => assistantActions.open()}
				>
					Start Assistant
				</button>
				<a
					class="rounded-xl border border-slate-700 bg-slate-800/50 px-8 py-4 text-sm font-bold backdrop-blur transition-all hover:bg-slate-800 hover:border-slate-600"
					href="#directories"
				>
					Explore Agents
				</a>
			</div>

			<!-- Stats bar -->
			<div class="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4" in:fly={{ y: 20, duration: 600, delay: 600 }}>
				{#each stats as stat}
					<div class="rounded-2xl border border-slate-700/50 bg-slate-800/50 px-4 py-4 backdrop-blur">
						<div class="text-2xl font-extrabold text-white">{stat.value}</div>
						<div class="mt-1 text-xs font-medium text-slate-400">{stat.label}</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- RERA Directories -->
	<section id="directories" class="space-y-8 scroll-mt-24">
		<div class="text-center">
			<h2 class="text-3xl font-bold tracking-tight text-slate-900">RERA State Directories</h2>
			<p class="mt-2 text-slate-500">Official registered agent databases updated in real-time.</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			{#each reraStates as state}
				<a
					href={state.href}
					class="group relative flex flex-col items-center justify-center rounded-2xl border {state.color} p-6 text-center transition-all hover:scale-105 hover:shadow-xl hover:shadow-slate-500/5"
				>
					<div class="text-3xl">{state.icon}</div>
					<div class="text-2xl font-black opacity-20 transition-opacity group-hover:opacity-40">{state.code}</div>
					<div class="mt-1 font-bold text-slate-800">{state.name}</div>
					<div class="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-indigo-500 transition-colors">View Directory &rarr;</div>
				</a>
			{/each}
		</div>
	</section>

	<!-- Loan Products from JSON -->
	<section class="space-y-8">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div class="max-w-xl">
				<h2 class="text-3xl font-bold tracking-tight text-slate-900">Financial Products</h2>
				<p class="mt-2 text-slate-500">Discover loan options with competitive rates and minimal documentation requirements.</p>
			</div>
			<a href="/loans" class="text-sm font-bold text-indigo-600 hover:text-indigo-500 transition-colors">View all products &rarr;</a>
		</div>

		<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
			{#each loanData.products as product}
				<div class="group relative flex flex-col rounded-3xl border border-slate-200 bg-white p-8 transition-all hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-500/5">
					<div class="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl {loanColors[product.name] || 'bg-slate-50 text-slate-600 border-slate-100'}">
						{loanIcons[product.name] || '💰'}
					</div>
					<h3 class="mt-6 text-xl font-bold text-slate-900">{product.name}</h3>
					<p class="mt-3 flex-1 text-sm leading-relaxed text-slate-500">{product.shortDescription}</p>

					<!-- Quick highlights from options -->
					<div class="mt-5 space-y-2">
						{#each product.options.slice(0, 2) as option}
							<div class="flex items-start gap-2 text-xs text-slate-500">
								<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
								</svg>
								<span><strong class="text-slate-700">{option.title}:</strong> {option.description.slice(0, 80)}...</span>
							</div>
						{/each}
					</div>

					<a
						href="/loans"
						class="mt-8 inline-flex items-center gap-1 font-bold text-indigo-600 text-sm group-hover:gap-2 transition-all"
					>
						View Details <span>&rarr;</span>
					</a>
				</div>
			{/each}
		</div>
	</section>

	<!-- General FAQ from JSON -->
	<section class="space-y-8">
		<div class="text-center">
			<h2 class="text-3xl font-bold tracking-tight text-slate-900">Frequently Asked Questions</h2>
			<p class="mt-2 text-slate-500">Quick answers to common queries about our services.</p>
		</div>

		<div class="mx-auto max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
			{#each loanData.generalFaq as faq}
				<details class="group">
					<summary class="flex cursor-pointer items-center justify-between px-6 py-5 text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600 [&::-webkit-details-marker]:hidden">
						{faq.question}
						<svg class="h-5 w-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</summary>
					<div class="px-6 pb-5 text-sm leading-relaxed text-slate-600">
						{faq.answer}
					</div>
				</details>
			{/each}
		</div>
	</section>

	<!-- Call to Action -->
	<section class="relative overflow-hidden rounded-3xl bg-indigo-600 p-8 text-white shadow-2xl sm:p-16">
		<div class="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl"></div>
		<div class="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-violet-500/30 blur-3xl"></div>

		<div class="relative z-10 mx-auto flex max-w-4xl flex-col items-center gap-8 text-center sm:flex-row sm:text-left">
			<div class="flex-1 space-y-4">
				<h2 class="text-3xl font-bold">Need help choosing the right path?</h2>
				<p class="text-indigo-100">Our virtual assistant can help you calculate loan eligibility and find the right RERA agents for your needs.</p>
			</div>
			<button
				class="flex-shrink-0 rounded-xl bg-white px-8 py-4 text-sm font-bold text-indigo-600 shadow-xl transition-all hover:bg-indigo-50 hover:scale-105 active:scale-95"
				on:click={() => assistantActions.open()}
			>
				Chat with Assistant
			</button>
		</div>
	</section>
</div>
