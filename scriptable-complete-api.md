# Scriptable API Reference

This document contains comprehensive API documentation for Scriptable. Each class is organized with its description, constructor, methods, and properties clearly documented.

## Table of Contents

- [CallbackURL](#callbackurl)
- [Alert](#alert)
- [Calendar](#calendar)
- [CalendarEvent](#calendarevent)
- [Color](#color)
- [Contact](#contact)
- [ContactsContainer](#contactscontainer)
- [ContactsGroup](#contactsgroup)
- [Data](#data)
- [DateFormatter](#dateformatter)
- [DatePicker](#datepicker)
- [Device](#device)
- [Dictation](#dictation)
- [DocumentPicker](#documentpicker)
- [DrawContext](#drawcontext)
- [FileManager](#filemanager)
- [Font](#font)
- [Image](#image)
- [Keychain](#keychain)
- [LinearGradient](#lineargradient)
- [ListWidget](#listwidget)
- [Location](#location)
- [Mail](#mail)
- [Message](#message)
- [Notification](#notification)
- [Pasteboard](#pasteboard)
- [Path](#path)
- [Photos](#photos)
- [Point](#point)
- [QuickLook](#quicklook)
- [Rect](#rect)
- [RecurrenceRule](#recurrencerule)
- [RelativeDateTimeFormatter](#relativedatetimeformatter)
- [Reminder](#reminder)
- [Request](#request)
- [SFSymbol](#sfsymbol)
- [Safari](#safari)
- [Script](#script)
- [ShareSheet](#sharesheet)
- [Size](#size)
- [Speech](#speech)
- [TextField](#textfield)
- [Timer](#timer)
- [UITable](#uitable)
- [UITableCell](#uitablecell)
- [UITableRow](#uitablerow)
- [URLScheme](#urlscheme)
- [UUID](#uuid)
- [WebView](#webview)
- [WidgetDate](#widgetdate)
- [WidgetImage](#widgetimage)
- [WidgetSpacer](#widgetspacer)
- [WidgetStack](#widgetstack)
- [WidgetText](#widgettext)
- [XMLParser](#xmlparser)

---

## CallbackURL

Open x-callback-url requests.

Opens apps that support x-callback-url and waits for a response from the target application. You can find a list of apps that support x-callback-url at [x-callback-url.com/apps](http://x-callback-url.com/apps/).

### Constructor

#### `new CallbackURL(baseURL: string)`

Constructs an object that opens x-callback-url requests and waits for a response from the target app.

**Parameters:**
- `baseURL` (string): Base URL of the request. This is usually something like my-app://x-callback-url/action

### Methods

#### `addParameter(name: string, value: string)`

Appends a key/value pair to the base URL as a query parameter. The name and value are automatically encoded. Do not add the x-callback-url parameters, i.e. x-source, x-success, x-error and x-cancel as Scriptable will add those.

**Parameters:**
- `name` (string): Name of the query parameter to add.
- `value` (string): Value of the query parameter to add.

#### `open(): Promise<{string: string}>`

Opens the callback URL.

Opens the target app and waits for the target app to perform the action. The returned promise contains the query parameters supplied by the target app when it invokes the callback. If the action failed in the target app or the action was cancelled, the promise will be rejected. The promise is also rejected if the action times out because the target app did not invoke the callback.

**Return value:**
- `Promise<{string: string}>`: Promise that provides the query parameters supplied by the target app when it invokes the callback.

#### `getURL(): string`

Creates the callback URL.

Creates a callback URL with the specified base URL and query parameters.

**Return value:**
- `string`: Configured callback URL.

---

## Alert

Presents an alert.

Use this to configure an alert presented modally or as a sheet. After configuring the alert, call presentAlert() or presentSheet() to present the alert. The two presentations methods will return a value which carries the index of the action that was selected when fulfilled.

### Properties

#### `title: string`

Title displayed in the alert. Usually a short string.

#### `message: string`

Detailed message displayed in the alert.

### Constructor

#### `new Alert()`

Constructs a new alert.

### Methods

#### `addAction(title: string)`

Adds an action to the alert.

Adds an action button to the alert. To check if an action was selected, you should use the first parameter provided when the promise returned by presentAlert() and presentSheet() is resolved.

**Parameters:**
- `title` (string): Title of the action.

#### `addDestructiveAction(title: string)`

Adds a destructive action to the alert.

Destructive action titles have a red text color, signaling that the action may modify or delete data.

**Parameters:**
- `title` (string): Title of the action.

#### `addCancelAction(title: string)`

Adds a cancel action to the alert.

Adds a cancel action to the alert. When a cancel action is selected, the index provided by presentAlert() or presentSheet() will always be -1. Please note that when running on the iPad and presenting using presentSheet(), the action will not be shown in the list of actions. The operation is cancelled by tapping outside the sheet.

An alert can only contain a single cancel action. Attempting to add more cancel actions will remove any previously added cancel actions.

**Parameters:**
- `title` (string): Title of the action.

#### `addTextField(placeholder: string, text: string): TextField`

Adds a text field prompting for user input.

Adds a text field to the alert controller prompting for user input. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

Text fields are not supported when using the sheet presentation.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `addSecureTextField(placeholder: string, text: string): TextField`

Adds a secure text field prompting for user input.

Adds a secure text field to the alert controller prompting for user input. Values entered into a secure text field will be hidden behind dots. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `textFieldValue(index: number): string`

Retrieves value of a text field.

Retrieves the value of a text field added using addTextField() or addSecureTextField(). Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `index` (number): Index of text field to retrieve for value.

**Return value:**
- `string`: Value of the text field at the specified index.

#### `present(): Promise<number>`

Presents the alert modally.

This is a shorthand for presentAlert().

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentAlert(): Promise<number>`

Presents the alert modally.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentSheet(): Promise<number>`

Presents the alert as a sheet.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

---

## Calendar

Holds reminders and events.

Use the Calendar type to get a specific calendar. The calendar is used with the Reminder and CalendarEvent types when fetching reminders or events from a specific calendar or when inserting into a calendar. If you are fetching reminders or events from all calendars, you do not need to pass the calendars when performing the fetch with the Reminder or CalendarEvent types.

### Properties

#### `identifier: string`

Calendar identifier.

*Read-only.*

#### `title: string`

Title of calendar.

#### `isSubscribed: bool`

Whether the calendar is a subscribed calendar.

*Read-only.*

#### `allowsContentModifications: bool`

Indicates whether items can be added, edited, and deleted in the calendar.

*Read-only.*

#### `color: Color`

Color of calendar.

### Methods

#### `supportsAvailability(availability: string): bool`

Checks if the calendar supports availability.

The following values are supported:
- busy
- free
- tentative
- unavailable

Not all calendars support all of these availabilities and some calendars may not support availability at all. Use this function to check if the calendar supports a specific availability.

**Parameters:**
- `availability` (string): Availability to check against.

**Return value:**
- `bool`: True if the calendar supports the availability, otherwise false.

#### `save()`

Saves calendar.

Saves changes to the calendar.

#### `remove()`

Removes calendar.

The calendar is removed immediately. This cannot be undone.

### Static Methods

#### `forReminders(): Promise<[Calendar]>`

Fetches calendars for reminders.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold reminders.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forEvents(): Promise<[Calendar]>`

Fetches calendars for events.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold events.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forRemindersByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds reminders.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `forEventsByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds events.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `createForReminders(title: string): Promise<Calendar>`

Create a new calendar that holds reminders.

This will create a new list for reminders in the Reminders app. The list is automatically saved so there is no need to call `save()` after creating the list.

**Return value:**
- `Promise<Calendar>`: Promise that provides the created calendar when fulfilled.

#### `findOrCreateForReminders(title: string): Promise<Calendar>`

Find or create a new calendar that holds reminders.

This will attempt to find a calendar for reminders with the specified name. If no calendar is found, a new calendar is created and the calendar will appear as a reminder list in the Reminders app. If multiple calendars are found for the specified name, the first one will be returned. The list is automatically saved so there is no need to call `save()` in the case the list was created.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForReminders(): Promise<Calendar>`

Default calendar for reminders.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold reminders.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForEvents(): Promise<Calendar>`

Default calendar for events.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold events.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `presentPicker(allowMultiple: bool): Promise<[Calendar]>`

Presents a view for picking calendars.

**Parameters:**
- `allowMultiple` (bool): Whether to allow picking multiple calenders. Defaults to false.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

---

## CalendarEvent

Manages events in calendars.

Used for creating, fetching and removing events from your calendars.

### Properties

#### `identifier: string`

Identifier of event.

*Read-only.*

#### `title: string`

Title of event.

#### `location: string`

Location of event.

#### `notes: string`

Notes associated with event.

#### `startDate: Date`

Start date of event.

#### `endDate: Date`

End date of event.

#### `isAllDay: bool`

Whether the event is an all-day event.

#### `attendees: [any]`

Attendees associated with the event.

*Read-only.*

An array of objects on the following form:

```javascript
{
  "isCurrentUser": false,
  "name": "John Appleseed",
  "status": "accepted",
  "type": "person",
  "role": "required"
}
```

Note that the property is read-only since iOS does not expose API to modify the attendees of an event.

#### `availability: string`

Availability during the event.

Indicates how the event should be treated for scheduling purposes. The following values are supported:
- busy
- free
- tentative
- unavailable

Be aware that not all calendars support all of these availabilities and some calendars may not support availability at all. Use `Calendar.supportsAvailability()` to check if a calendar supports a specific availability.

#### `timeZone: string`

Time zone of event.

Geopolitical region identifier that identifies the time zone, e.g. "Europe/Copenhagen", "America/New_York" and "Asia/Tokyo".

#### `calendar: Calendar`

Calendar the event is stored in.

### Constructor

#### `new CalendarEvent()`

Constructs an event.

In order to add the event to your calendar, you must call the save() function.

### Methods

#### `addRecurrenceRule(recurrenceRule: RecurrenceRule)`

Adds a recurrence rule.

Recurrence rules specify when the eventer or reminder should be repeated. See the documentation of RecurrenceRule for more information on creating rules.

**Parameters:**
- `recurrenceRule` (RecurrenceRule): Recurrence rule to add to the reminder.

#### `removeAllRecurrenceRules()`

Removes all recurrence rules.

#### `save()`

Saves event.

Saves changes to an event, inserting it into the calendar if it is newly created.

#### `remove()`

Removes event from calendar.

#### `presentEdit(): Promise<CalendarEvent>`

Presents a view for editing the calendar event.

The presented view supports editing various attributes of the event, including title, location, dates, recurrence and alerts.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the updated event when fulfilled.

### Static Methods

#### `presentCreate(): Promise<CalendarEvent>`

Presents a view for creating a calendar event.

The presented view supports editing various attributes of the event, including title, location, dates, recurrence and alerts.

**Return value:**
- `Promise<CalendarEvent>`: Promise that provides the created event when fulfilled.

#### `today(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events occurring today.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `tomorrow(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events occurring tomorrow.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `yesterday(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurred yesterday.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `thisWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occur this week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `nextWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occur next week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `lastWeek(calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurred last week.

**Parameters:**
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

#### `between(startDate: Date, endDate: Date, calendars: [Calendar]): Promise<[CalendarEvent]>`

Events that occurs between two dates.

**Parameters:**
- `startDate` (Date): Start date to fetch events for.
- `endDate` (Date): End date to fetch events for.
- `calendars` ([Calendar]): Calendars to fetch events for. Defaults to all calendars.

**Return value:**
- `Promise<[CalendarEvent]>`: Promise that provides the events when fulfilled.

---

## Color

Stores color data including opacity.

A color can be created using a hex value, e.g. #FF0000 and optionally an alpha or it can be created using the provided system colors.

### Properties

#### `hex: string`

HEX representation.

*Read-only.*

#### `red: number`

Amount of red in the color.

*Read-only.*

#### `green: number`

Amount of green in the color.

*Read-only.*

#### `blue: number`

Amount of blue in the color.

*Read-only.*

#### `alpha: number`

Alpha of the color.

*Read-only.*

### Constructor

#### `new Color(hex: string, alpha: number)`

Constructs a color.

Constructs a new color with a hex value and optionally an alpha value. The hex value may specify the alpha value but this will be ignored if the alpha value parameter is provided. Examples of valid hex values: #ff0000, #00ff0080, #00f and #ff. The hashtag is optional.

**Parameters:**
- `hex` (string): Hex value.
- `alpha` (number): Alpha value.

### Static Methods

#### `black(): Color`

Constructs a black color.

**Return value:**
- `Color`: A black color.

#### `darkGray(): Color`

Constructs a dark gray color.

**Return value:**
- `Color`: A dark gray color.

#### `lightGray(): Color`

Constructs a light gray color.

**Return value:**
- `Color`: A light gray color.

#### `white(): Color`

Constructs a white color.

**Return value:**
- `Color`: A white color.

#### `gray(): Color`

Constructs a gray color.

**Return value:**
- `Color`: A gray color.

#### `red(): Color`

Constructs a red color.

**Return value:**
- `Color`: A red color.

#### `green(): Color`

Constructs a green color.

**Return value:**
- `Color`: A green color.

#### `blue(): Color`

Constructs a blue color.

**Return value:**
- `Color`: A blue color.

#### `cyan(): Color`

Constructs a cyan color.

**Return value:**
- `Color`: A cyan color.

#### `yellow(): Color`

Constructs a yellow color.

**Return value:**
- `Color`: A yellow color.

#### `magenta(): Color`

Constructs a magenta color.

**Return value:**
- `Color`: A magenta color.

#### `orange(): Color`

Constructs a orange color.

**Return value:**
- `Color`: A orange color.

#### `purple(): Color`

Constructs a purple color.

**Return value:**
- `Color`: A purple color.

#### `brown(): Color`

Constructs a brown color.

**Return value:**
- `Color`: A brown color.

#### `clear(): Color`

Constructs a transparent color.

**Return value:**
- `Color`: A transparent color.

#### `dynamic(lightColor: Color, darkColor: Color): Color`

Creates a dynamic color.

The dynamic color will use either its light or dark variant depending the appearance of the system.

Dynamic colors are not supported when used with `DrawContext`.

**Parameters:**
- `lightColor` (Color): Color used in light appearance.
- `darkColor` (Color): Color used in dark appearance.

**Return value:**
- `Color`: Dynamic color.

---

## Contact

Contact in the address book.

The type represents a contact in the address book. You can use the type to fetch and update contacts in the address book. If you are signed into multiple accounts on the device, you may have multiple sources that populate the address book. A source is is represented as a `ContactsContainer`. A contact may be in only one container. A CardDAV account usually has a single container whereas an Exchange account may have multiple containers.

### Properties

#### `identifier: string`

Uniquely identifies the contact on the device.

*Read-only.*

#### `namePrefix: string`

Name prefix.

#### `givenName: string`

Given name.

#### `middleName: string`

Middle name.

#### `familyName: string`

Family name.

#### `nickname: string`

Nickname.

#### `birthday: Date`

Birthday.

#### `image: Image`

Profile picture.

#### `emailAddresses: [{string: string}]`

Email addresses.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "value": "my@example.com"
}
```

The identifier uniquely identifies the email address on this device. The label is a description of the email address and the value holds the email address itself.

When updating this property, you must set the entire array of email addresses that you would like to store on the contact. Each value in the array must have the "value" key. The other keys are optional.

#### `phoneNumbers: [{string: string}]`

Phone numbers.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "value": "(111)234-5678"
}
```

The identifier uniquely identifies the phone number on this device. The label is a description of the phone number and the value holds the phone number itself.

When updating this property, you must set the entire array of phone numbers that you would like to store on the contact. Each value in the array must have the "value" key. The other keys are optional.

#### `postalAddresses: [{string: string}]`

Postal addresses.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Home",
  "localizedLabel": "Home",
  "street": "240  Terry Lane",
  "city": "New York",
  "state": "New York",
  "postalCode": "10001",
  "country": "United States of America"
}
```

The identifier uniquely identifies the pstal address on this device. The label is a description of the phone number and the value holds the phone number itself.

When updating this property, you must set the entire array of postal addresses that you would like to store on the contact. The "identifier" key is optional.

#### `socialProfiles: [{string: string}]`

Social profiles.

An array of objects on the following form:

```javascript
{
  "identifier": "UUID-ABC-123",
  "label": "Twitter",
  "localizedLabel": "Twitter",
  "service": "Twitter",
  "url": "https://twitter.com/scriptableapp",
  "userIdentifier": null,
  "username": "scriptableapp"
}
```

### Constructor

#### `new Contact()`

Constructs a contact.

In order to add the contact to your address book, you must queue it for insertion using `Contact.add()`. When you're done making changes to the address book you should call `Contact.persistChanges()` to persist the changes.

### Static Methods

#### `all(containers: [ContactsContainer]): Promise<[Contact]>`

Fetches contacts.

Fetches the contacts in the specified containers. A contact can be in only one container.

**Parameters:**
- `containers` ([ContactsContainer]): Containers to fetch contacts from.

**Return value:**
- `Promise<[Contact]>`: Promise that provides the contacts when fulfilled.

#### `inGroups(groups: [ContactsGroup]): Promise<[Contact]>`

Fetches contacts in groups.

Fetches the contacts in the specified contacts groups. A contact may belong to many groups.

**Parameters:**
- `groups` ([ContactsGroup]): Groups to fetch contacts from.

**Return value:**
- `Promise<[Contact]>`: Promise that provides the contacts when fulfilled.

#### `add(contact: Contact, containerIdentifier: string)`

Queues a contact to be added.

After you have created a contact, you must queue the contact to be added to the address book and invoke `Contact.persistChanges()` to persist the changes to the address book.

For performance reasons, it is best to batch changes to the address book. Therefore you should queue all updates, insertions and removals of contacts and contacts groups to as large batches as possible and then call `Contact.persistChanges()` when you want to persist the changes to the address book.

**Parameters:**
- `contact` (Contact): Contact to queue to be added.
- `containerIdentifier` (string): Optional. Identifier of container to add the contact to. If null is specified, the contact will be added to the default container.

#### `update(contact: Contact)`

Queues an update to a contact.

After you have updated one or more properties on a contact, you must queue the contact to be updated and invoke `Contact.persistChanges()` to persist the changes to the address book.

For performance reasons, it is best to batch changes to the address book. Therefore you should queue all updates, insertions and removals of contacts and contacts groups to as large batches as possible and then call `Contact.persistChanges()` when you want to persist the changes to the address book.

**Parameters:**
- `contact` (Contact): Contact to queue to be updated.

---

## ContactsContainer

Collection of contacts.

If you're signed into multiple accounts on your device, you may have multiple contact containers. A contact can be in only one container. CardDAV accounts usually have a single container whereas Exchange accounts may have multiple containers. A container may have multiple groups. While a single contact can only belong to one container, a contact may belong to many groups.

### Properties

#### `identifier: string`

Identifier of the contacts container.

*Read-only.*

#### `name: string`

Name of the contacts container.

*Read-only.*

### Static Methods

#### `default(): Promise<ContactsContainer>`

Fetches default contacts container.

**Return value:**
- `Promise<ContactsContainer>`: Promise that provides the default contacts container when fulfilled.

#### `all(): Promise<[ContactsContainer]>`

Fetches all contacts containers.

**Return value:**
- `Promise<[ContactsContainer]>`: Promise that provides all contacts containers when fulfilled.

#### `withIdentifier(identifier: string): Promise<ContactsContainer>`

Fetches a contacts container.

**Parameters:**
- `identifier` (string): Identifier of the contacts container to fetch.

**Return value:**
- `Promise<ContactsContainer>`: Promise that provides the contacts container when fulfilled.

---

## ContactsGroup

Group of contacts.

A contacts container may have several groups of contacts. A contact can only belong to a single contacts container but may belong to zero or more contacts groups. For example, an iCloud account has only one container but may have many groups.

### Properties

#### `identifier: string`

Identifier of the contacts group.

*Read-only.*

#### `name: string`

Name of the contacts group.

### Constructor

#### `new ContactsGroup()`

Constructs a contacts group.

In order to add the group to your address book, you must queue it for insertion using `ContactsGroup.add()`. When you're done making changes to the address book you should call `Contact.persistChanges()` to persist the changes.

### Methods

#### `addMember(contact: Contact)`

Adds a contact to the group.

In order to persist the change, you should call `Contact.persistChanges()`. It is important that the contact is added to the address book. To add the contact to the address book, you should queue it for insertion using `Contact.add()` before persisting the changes.

**Parameters:**
- `contact` (Contact): Contact to add to the group.

#### `removeMember(contact: Contact)`

Removes a contact from the group.

In order to persist the change, you should call `Contact.persistChanges()`. It is important that the contact is added to the address book. To add the contact to the address book, you should queue it for insertion using `Contact.add()` before persisting the changes.

**Parameters:**
- `contact` (Contact): Contact to add to the group.

### Static Methods

#### `all(containers: [ContactsContainer]): Promise<[ContactsGroup]>`

Fetches contacts groups.

Fetches the contacts groups in the specified containers. A group can be in only one container.

**Parameters:**
- `containers` ([ContactsContainer]): Container to fetch contacts groups from.

**Return value:**
- `Promise<[ContactsGroup]>`: Promise that provides the contacts groups when fulfilled.

---

## Data

Raw data representation.

Raw data representation of strings, files and images.

### Static Methods

#### `fromString(string: string): Data`

Creates data from string.

The provided string is assumed to be UTF8 encoded. If the string is not UTF8 encoded, the function will return null.

**Parameters:**
- `string` (string): String to create data from.

**Return value:**
- `Data`: Data representation of the string.

#### `fromFile(filePath: string): Data`

Reads data from file path.

Reads the raw data of the file at the specified file path.

**Parameters:**
- `filePath` (string): Path of file to read data from.

**Return value:**
- `Data`: Data representation of the file.

#### `fromBase64String(base64String: string): Data`

Creates data from base64 encoded string.

The supplied string must be base64 encoded otherwise the function will return null.

**Parameters:**
- `base64String` (string): Base64 encoded string to create data from.

**Return value:**
- `Data`: Data representation of the string.

#### `fromJPEG(image: Image): Data`

Creates data from JPEG image.

**Parameters:**
- `image` (Image): JPEG image to convert to data.

**Return value:**
- `Data`: Data representation of the image.

#### `fromPNG(image: Image): Data`

Creates data from PNG image.

**Parameters:**
- `image` (Image): PNG image to convert to data.

**Return value:**
- `Data`: Data representation of the image.

#### `fromBytes(bytes: [number]): Data`

Creates data from an array of bytes.

**Parameters:**
- `bytes` ([number]): Array of bytes to convert to data.

**Return value:**
- `Data`: Data creates from the bytes.

### Methods

#### `toRawString(): string`

Creates a string from the data.

The data is assumed to represent a UTF8 encoded string. If the string is not UTF8 encoded string, the function will return null.

**Return value:**
- `string`: Data converted to string.

#### `toBase64String(): string`

Creates a base64 encoded string.

Creates a base64 encoded string from the data.

**Return value:**
- `string`: Base64 encoded string.

#### `getBytes(): [number]`

Gets bytes from data.

**Return value:**
- `[number]`: Array of bytes.

---

## Device

Provides information about the device.

Reads information about the current device and its screen.

### Static Methods

#### `name(): string`

Name identifying the device.

You can find and edit the name of your device in the system settings.

#### `systemName(): string`

Name of the operating system.

#### `systemVersion(): string`

Version of the operating system.

#### `model(): string`

Model of the device, e.g. "iPhone".

#### `isPhone(): bool`

Whether the device is a phone.

You can use this property to choose behavior of a script depending on whether its running on a phone or a pad.

#### `isPad(): bool`

Whether the device is a pad.

You can use this property to choose behavior of a script depending on whether its running on a phone or a pad.

#### `screenSize(): Size`

Size of the screen.

The value is measured in points. For an explanation of the relationship between points and pixels, see the documentation of the `screenScale()` method. The value takes the device rotation into account, so the value will vary between portrait and landscape.

#### `screenResolution(): Size`

Resolution of the screen.

The value is measured in pixels. The value does not take the rotation of the deviec into account.

#### `screenScale(): number`

Scale of the screen.

Standard resolution displays have a scale of 1.0 where one point on the screen equals one pixel. Retina displays will have a scale factor of 2.0 or 3.0 where one point on the screen is four or nine pixels, respectively.

#### `screenBrightness(): number`

Brightness of the screen in percentage.

The value range from 0 to 1. To set the screen brightness, refer to the `setScreenBrightness()` function.

#### `isInPortrait(): bool`

Whether the device is in portrait with the home button or home indicator at the bottom.

#### `isInPortraitUpsideDown(): bool`

Whether the device is in portrait but upside down with the home button or home indicator at the top.

#### `isInLandscapeLeft(): bool`

Whether the device is in landscape with the home button or home indicator on the right side.

#### `isInLandscapeRight(): bool`

Whether the device is in landscape with the home button or home indicator on the left side.

#### `isFaceUp(): bool`

Whether the device is lying parallel to the ground with the screen facing upwards.

#### `isFaceDown(): bool`

Whether the device is lying parallel to the ground with the screen facing downwards.

#### `batteryLevel(): number`

Current battery level.

The value is in percentage ranging between 0 and 1.

#### `isDischarging(): bool`

Whether the device is being not plugged into power and thus discharging.

#### `isCharging(): bool`

Whether the device is being charged.

#### `isFullyCharged(): bool`

Whether the device is fully charged.

#### `preferredLanguages(): [string]`

The preferred langauges.

The list is ordered according to the language preferences specified in the system settings.

#### `locale(): string`

Identifier for the device locale.

#### `language(): string`

Identifier for the device language.

#### `isUsingDarkAppearance(): bool`

Whether the device is using dark appearance.

This API is not supported in widgets.

#### `volume(): number`

The device volume.

The value range from 0 to 1.

#### `setScreenBrightness(percentage: number)`

Sets the brightness of the screen.

The value range from 0 to 1. To get the screen brightness, refer to the `screenBrightness()` function.

**Parameters:**
- `percentage` (number): Percentage to set the screen brightness to. Value between 0 and 1.

---