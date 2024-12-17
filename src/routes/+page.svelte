<script lang="ts">
	import { browser } from '$app/environment';
	import { faker } from '@faker-js/faker';

	async function server_getUserData(intro: string) {
		return {
			data: {
				id: faker.number.int({ min: 100, max: 10000 }),
				name: faker.person.fullName(),
				intro: intro,
			},
			meta: {
				completedAt: new Date().toISOString(),
				runBy: browser ? 'browser' : 'server',
			},
		};
	}

	let userData = $state({ id: 0, name: 'Unknown', intro: 'Unknown' });
	let metaData = $state<{ completedAt: string; runBy: string }>();
</script>

<div class="container mx-auto max-w-2xl px-4 py-8">
	<h1 class="mb-6 text-3xl font-light">Server Functions Demo</h1>

	<p class="mb-8 text-gray-600">
		Click the button below to fetch user data from the server. Try running with and without the
		preprocessor, and check the network tab.
	</p>

	<button
		class="mb-12 rounded-lg bg-indigo-600 px-6 py-2 text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
		onclick={async () => {
			const response = await server_getUserData('hi there!');
			userData = response.data;
			metaData = response.meta;
		}}>
		Fetch Data
	</button>

	<div class="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
		<div class="space-y-4">
			<div class="flex justify-between border-b border-gray-100 pb-3">
				<span class="text-gray-600">ID</span>
				<span class="font-medium">{userData.id}</span>
			</div>

			<div class="flex justify-between border-b border-gray-100 pb-3">
				<span class="text-gray-600">Name</span>
				<span class="font-medium">{userData.name}</span>
			</div>
			<div class="flex justify-between border-b border-gray-100 pb-3">
				<span class="text-gray-600">Name</span>
				<span class="font-medium">{userData.intro}</span>
			</div>

			<div class="flex justify-between border-b border-gray-100 pb-3">
				<span class="text-gray-600">Completed At</span>
				<span class="font-medium">{metaData?.completedAt}</span>
			</div>

			<div class="flex justify-between">
				<span class="text-gray-600">Run By</span>
				<span class="font-medium">{metaData?.runBy}</span>
			</div>
		</div>
	</div>
</div>
