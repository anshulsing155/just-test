<script>
	import { assistantState, assistantActions } from '$lib/stores/assistantStore';
	import { fade, fly } from 'svelte/transition';

	// Demo functions
	function openAssistant() {
		assistantActions.open();
	}

	function askTimeQuestion() {
		if (!$assistantState.isOpen) {
			assistantActions.open();
		}
		assistantActions.processMessage('What time is it?');
	}

	function askJokeQuestion() {
		if (!$assistantState.isOpen) {
			assistantActions.open();
		}
		assistantActions.processMessage('Tell me a joke');
	}
</script>

<div class="max-w-4xl mx-auto space-y-12 py-8">
	<section class="text-center space-y-4">
		<h1 class="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
			Virtual Assistant <span class="text-indigo-600">Demo</span>
		</h1>
		<p class="text-lg text-slate-600 max-w-2xl mx-auto">
			Experience the power of our smart assistant. It's designed to help you navigate RERA regulations, find the right loan, and more.
		</p>
	</section>

	<section class="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
		<div class="grid gap-12 lg:grid-cols-2 lg:items-center">
			<div class="space-y-6">
				<h2 class="text-2xl font-bold text-slate-900">Try Out SvelteBot</h2>
				<p class="text-slate-600 leading-relaxed">
					Our virtual assistant can help you with various tasks. Click the assistant icon in the bottom
					right corner to start chatting, or try one of these quick actions to see it in action:
				</p>

				<div class="flex flex-wrap gap-3">
					<button 
						on:click={openAssistant}
						class="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500 hover:scale-105"
					>
						Open Assistant
					</button>
					<button 
						on:click={askTimeQuestion}
						class="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300"
					>
						Ask for the Time
					</button>
					<button 
						on:click={askJokeQuestion}
						class="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300"
					>
						Ask for a Joke
					</button>
				</div>
			</div>

			<div class="relative rounded-2xl bg-slate-900 p-4 shadow-2xl">
				<div class="flex items-center gap-2 mb-4 border-b border-slate-800 pb-2 px-2">
					<div class="flex gap-1.5">
						<div class="h-2.5 w-2.5 rounded-full bg-red-500/50"></div>
						<div class="h-2.5 w-2.5 rounded-full bg-yellow-500/50"></div>
						<div class="h-2.5 w-2.5 rounded-full bg-green-500/50"></div>
					</div>
					<div class="text-[10px] font-mono text-slate-500 uppercase tracking-widest ml-2">Conversation Terminal</div>
				</div>
				<div class="space-y-3 font-mono text-xs">
					<div class="flex gap-2 text-indigo-400">
						<span class="opacity-50">14:20:05</span>
						<span class="font-bold">[System]</span>
						<span>Assistant initialized...</span>
					</div>
					<div class="flex gap-2 text-emerald-400">
						<span class="opacity-50">14:20:06</span>
						<span class="font-bold">[Bot]</span>
						<span>"Hello! I'm SvelteBot. How can I help you today?"</span>
					</div>
					<div class="flex gap-2 text-slate-400">
						<span class="opacity-50">14:20:10</span>
						<span class="font-bold">[User]</span>
						<span>"Tell me a joke"</span>
					</div>
					<div class="flex gap-2 text-emerald-400">
						<span class="opacity-50">14:20:11</span>
						<span class="font-bold">[Bot]</span>
						<span>"Why don't scientists trust atoms? Because they make up everything!"</span>
					</div>
					<div class="animate-pulse flex gap-2 text-indigo-400">
						<span class="opacity-50">14:20:15</span>
						<span class="font-bold">[System]</span>
						<span>Awaiting user input_</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="space-y-8">
		<h2 class="text-3xl font-bold tracking-tight text-center text-slate-900">Key Features</h2>

		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
			<div class="rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-indigo-100 hover:shadow-xl hover:shadow-indigo-500/5">
				<div class="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 text-xl">🎤</div>
				<h3 class="font-bold text-slate-900">Voice Input</h3>
				<p class="mt-2 text-sm text-slate-500 leading-relaxed">Speak directly to the assistant using your microphone for a hands-free experience.</p>
			</div>

			<div class="rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-emerald-100 hover:shadow-xl hover:shadow-emerald-500/5">
				<div class="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 text-xl">🧠</div>
				<h3 class="font-bold text-slate-900">Smart Responses</h3>
				<p class="mt-2 text-sm text-slate-500 leading-relaxed">Get intelligent, context-aware answers using OpenAI's advanced language models.</p>
			</div>

			<div class="rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-blue-100 hover:shadow-xl hover:shadow-blue-500/5">
				<div class="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 text-xl">🎨</div>
				<h3 class="font-bold text-slate-900">Modern UI</h3>
				<p class="mt-2 text-sm text-slate-500 leading-relaxed">A beautiful, responsive interface that works perfectly across all devices and sizes.</p>
			</div>

			<div class="rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-purple-100 hover:shadow-xl hover:shadow-purple-500/5">
				<div class="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-4 text-xl">🔒</div>
				<h3 class="font-bold text-slate-900">Secure Flows</h3>
				<p class="mt-2 text-sm text-slate-500 leading-relaxed">Built-in OTP verification and user validation for sensitive operations.</p>
			</div>
		</div>
	</section>
</div>
